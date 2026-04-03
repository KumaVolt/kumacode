/**
 * Task tool — spawns an isolated sub-agent loop for deep exploration.
 *
 * The main LLM decides when to delegate a task to a subagent. The subagent
 * gets its own message history, a focused system prompt, and a limited set
 * of tools (Read, Glob, Grep, Bash by default — read-only exploration).
 * It runs the same agent loop as the main conversation but in isolation,
 * then returns a summary of its findings.
 *
 * Requires permission because it runs Bash commands internally.
 */
import { z } from "zod"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"
import type { Message, ToolCall, ChatParams, StreamEvent } from "../provider/base.js"
import { providerRegistry } from "../provider/registry.js"
import { toolRegistry } from "./registry.js"
import { bus } from "../bus/bus.js"
import { generateId } from "../util/id.js"
import { estimateTokens, compactMessages } from "../agent/context.js"

export const TaskInputSchema = z.object({
  description: z.string().describe(
    "A short (3-5 word) description of the task, shown in the UI"
  ),
  prompt: z.string().describe(
    "Detailed instructions for the sub-agent. Include all necessary context — " +
    "the sub-agent has no access to the main conversation history."
  ),
  allowedTools: z.array(z.string()).optional().describe(
    "Override the default tool set. Defaults to: Read, Glob, Grep, Bash"
  ),
  maxRounds: z.number().optional().describe(
    "Maximum number of agent loop rounds (default 15)"
  ),
})

/** Default tools available to subagents — read-only exploration */
const DEFAULT_SUBAGENT_TOOLS = ["Read", "Glob", "Grep", "Bash"]

export const taskTool: Tool = {
  name: "Task",
  description:
    "Launch a sub-agent to handle a complex, multi-step exploration or research task autonomously. " +
    "The sub-agent runs in isolation with its own conversation and limited tools (Read, Glob, Grep, Bash). " +
    "Use this for tasks like: searching a large codebase, analyzing multiple files, " +
    "exploring directory structures, or answering questions that require reading many files. " +
    "The sub-agent returns a summary of its findings. " +
    "Include all necessary context in the prompt — the sub-agent cannot see the main conversation.",
  inputSchema: TaskInputSchema,
  requiresPermission: true,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = TaskInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { description, prompt, allowedTools, maxRounds = 15 } = parsed.data

    // Resolve which provider/model to use (same as main conversation)
    const active = providerRegistry.getActive()
    if (!active) {
      return { output: "No active provider/model. Cannot spawn sub-agent.", isError: true }
    }

    const { provider, model } = active
    const taskId = generateId()

    // Determine the tools available to this sub-agent
    const toolNames = allowedTools ?? DEFAULT_SUBAGENT_TOOLS
    const availableTools = toolNames
      .map((name) => toolRegistry.get(name))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)

    if (availableTools.length === 0) {
      return { output: "No valid tools found for sub-agent.", isError: true }
    }

    // Build the sub-agent system prompt
    const systemPrompt = buildSubagentSystemPrompt(description, context.cwd, toolNames)

    // Initialize sub-agent messages with the task prompt
    const messages: Message[] = [
      { role: "user", content: prompt },
    ]

    bus.emit("subagent:start", { taskId, description })

    try {
      const result = await runSubagentLoop(messages, {
        provider,
        model,
        tools: availableTools,
        systemPrompt,
        maxRounds,
        cwd: context.cwd,
        abortSignal: context.abortSignal,
        checkPermission: context.checkPermission,
        taskId,
      })

      bus.emit("subagent:end", { taskId, description, success: true })

      return {
        output: result.summary,
        isError: false,
        metadata: {
          taskId,
          description,
          rounds: result.rounds,
          toolCalls: result.toolCallCount,
        },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      bus.emit("subagent:end", { taskId, description, success: false })
      return { output: `Sub-agent error: ${msg}`, isError: true }
    }
  },
}

/**
 * Build a focused system prompt for the sub-agent.
 */
function buildSubagentSystemPrompt(
  taskDescription: string,
  cwd: string,
  toolNames: string[],
): string {
  return [
    `You are a KumaCode sub-agent performing a focused task: "${taskDescription}".`,
    "",
    "## Instructions",
    "- You are running in an isolated context with limited tools.",
    `- Available tools: ${toolNames.join(", ")}`,
    `- Working directory: ${cwd}`,
    "- Explore the codebase, read files, search for patterns, and run commands as needed.",
    "- Be thorough but efficient — read relevant files, not everything.",
    "- When you have gathered enough information, provide a clear, comprehensive summary.",
    "- Your final message should be a complete answer to the task — include file paths, ",
    "  line numbers, code snippets, and any other relevant details.",
    "- Do NOT ask questions — you cannot interact with the user.",
    "- If you encounter errors, work around them and note them in your summary.",
    "",
    "## Output Format",
    "Your final message should contain all findings. Be specific:",
    "- Reference exact file paths and line numbers",
    "- Include relevant code snippets",
    "- Summarize patterns, issues, or answers discovered",
  ].join("\n")
}

interface SubagentLoopOptions {
  provider: { chat(params: ChatParams): AsyncIterable<StreamEvent>; config: { id: string; name: string } }
  model: { id: string; contextWindow: number; maxOutput: number }
  tools: Array<{
    name: string
    description: string
    inputSchema: import("zod").ZodType
    requiresPermission: boolean
    execute(input: ToolInput, context: ToolContext): Promise<ToolOutput>
  }>
  systemPrompt: string
  maxRounds: number
  cwd: string
  abortSignal?: AbortSignal
  checkPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  taskId: string
}

interface SubagentResult {
  summary: string
  rounds: number
  toolCallCount: number
}

/**
 * Run the sub-agent loop — similar to the main agent loop but isolated.
 * Does NOT emit main bus events for stream/message (to avoid polluting the TUI).
 * Only emits subagent-specific tool events for the TUI activity indicator.
 */
async function runSubagentLoop(
  messages: Message[],
  options: SubagentLoopOptions,
): Promise<SubagentResult> {
  const { provider, model, tools, systemPrompt, maxRounds, cwd, taskId } = options
  const allMessages = [...messages]
  let rounds = 0
  let toolCallCount = 0

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  for (let round = 0; round < maxRounds; round++) {
    if (options.abortSignal?.aborted) break
    rounds++

    // Context window management for the sub-agent
    const estimatedTokens = estimateTokens(allMessages)
    const compactionThreshold = Math.floor(model.contextWindow * 0.7) // Slightly more aggressive
    if (estimatedTokens > compactionThreshold) {
      const compacted = await compactMessages(allMessages, compactionThreshold, {
        provider: provider as any,
        modelId: model.id,
      })
      allMessages.length = 0
      allMessages.push(...compacted)
    }

    const chatParams: ChatParams = {
      model: model.id,
      messages: allMessages,
      tools: toolDefs,
      systemPrompt,
      maxTokens: model.maxOutput,
    }

    // Collect the streamed response (without emitting to main bus)
    let responseText = ""
    const toolCalls: ToolCall[] = []
    const pendingToolCall: Partial<ToolCall> & { inputJson?: string } = {}

    for await (const event of provider.chat(chatParams)) {
      if (options.abortSignal?.aborted) break

      switch (event.type) {
        case "text_delta":
          responseText += event.text ?? ""
          break
        case "tool_call_start":
          pendingToolCall.id = event.toolCall?.id ?? generateId()
          pendingToolCall.name = event.toolCall?.name ?? ""
          pendingToolCall.inputJson = ""
          break
        case "tool_call_delta":
          if (pendingToolCall.inputJson !== undefined) {
            pendingToolCall.inputJson += event.text ?? ""
          }
          break
        case "tool_call_end":
          if (pendingToolCall.name) {
            let parsedInput: Record<string, unknown> = {}
            try {
              parsedInput = JSON.parse(pendingToolCall.inputJson || "{}")
            } catch {
              parsedInput = { raw: pendingToolCall.inputJson }
            }
            toolCalls.push({
              id: pendingToolCall.id ?? generateId(),
              name: pendingToolCall.name,
              input: parsedInput,
            })
          }
          pendingToolCall.id = undefined
          pendingToolCall.name = undefined
          pendingToolCall.inputJson = undefined
          break
        case "error":
          throw new Error(event.error ?? "Unknown sub-agent streaming error")
      }
    }

    // Build assistant message
    const assistantMessage: Message = {
      role: "assistant",
      content: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
    allMessages.push(assistantMessage)

    // If no tool calls, the sub-agent is done — return the response as summary
    if (toolCalls.length === 0) {
      return { summary: responseText, rounds, toolCallCount }
    }

    // Execute tool calls
    const toolResults = await executeSubagentToolCalls(toolCalls, tools, {
      cwd,
      abortSignal: options.abortSignal,
      checkPermission: options.checkPermission,
    }, taskId)

    toolCallCount += toolCalls.length

    // Add tool results
    const toolResultMessage: Message = {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result" as const,
        toolCallId: r.toolCallId,
        output: r.output,
        isError: r.isError,
      })),
      toolResults,
    }
    allMessages.push(toolResultMessage)
  }

  // If we exhausted all rounds, extract the last assistant response as summary
  const lastAssistant = allMessages
    .filter((m) => m.role === "assistant")
    .pop()
  const summary = typeof lastAssistant?.content === "string"
    ? lastAssistant.content
    : "(Sub-agent reached maximum rounds without producing a final summary)"

  return { summary, rounds, toolCallCount }
}

/**
 * Execute tool calls for a sub-agent, emitting subagent-specific events.
 */
async function executeSubagentToolCalls(
  toolCalls: ToolCall[],
  tools: SubagentLoopOptions["tools"],
  context: { cwd: string; abortSignal?: AbortSignal; checkPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean> },
  taskId: string,
): Promise<Array<{ toolCallId: string; output: string; isError: boolean }>> {
  const results: Array<{ toolCallId: string; output: string; isError: boolean }> = []

  for (const call of toolCalls) {
    const tool = tools.find((t) => t.name === call.name)
    if (!tool) {
      results.push({
        toolCallId: call.id,
        output: `Error: Tool "${call.name}" is not available in this sub-agent.`,
        isError: true,
      })
      continue
    }

    // Emit subagent tool events so the TUI can show activity
    bus.emit("subagent:tool", { taskId, toolCallId: call.id, name: call.name, input: call.input, status: "start" })

    // Check permission if required
    if (tool.requiresPermission && context.checkPermission) {
      const allowed = await context.checkPermission(call.name, call.input)
      if (!allowed) {
        bus.emit("subagent:tool", { taskId, toolCallId: call.id, name: call.name, input: call.input, status: "denied" })
        results.push({ toolCallId: call.id, output: "Permission denied by user.", isError: true })
        continue
      }
    }

    try {
      const output = await tool.execute(call.input, {
        cwd: context.cwd,
        abortSignal: context.abortSignal,
        checkPermission: context.checkPermission,
      })
      bus.emit("subagent:tool", { taskId, toolCallId: call.id, name: call.name, input: call.input, status: "done" })
      results.push({ toolCallId: call.id, output: output.output, isError: output.isError })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      bus.emit("subagent:tool", { taskId, toolCallId: call.id, name: call.name, input: call.input, status: "error" })
      results.push({ toolCallId: call.id, output: `Error: ${msg}`, isError: true })
    }
  }

  return results
}
