import type { Message, ChatParams, StreamEvent, ToolCall } from "../provider/base.js"
import { providerRegistry } from "../provider/registry.js"
import { toolRegistry } from "../tool/registry.js"
import type { ToolContext, ToolOutput } from "../tool/base.js"
import { bus } from "../bus/bus.js"
import { generateId } from "../util/id.js"

export interface AgentLoopOptions {
  /** Working directory for tool execution */
  cwd: string
  /** System prompt to use */
  systemPrompt: string
  /** Maximum number of tool-call rounds before forcing a response */
  maxRounds?: number
  /** Abort signal to cancel the loop */
  abortSignal?: AbortSignal
  /** Callback to check tool permissions */
  checkPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export interface AgentLoopResult {
  messages: Message[]
  totalInputTokens: number
  totalOutputTokens: number
}

/**
 * The core agentic loop: send messages to the LLM, execute tool calls,
 * feed results back, and repeat until the model stops calling tools.
 */
export async function runAgentLoop(
  messages: Message[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxRounds = options.maxRounds ?? 20
  const active = providerRegistry.getActive()
  if (!active) throw new Error("No active provider/model. Run /connect to set one up.")

  const { provider, model } = active
  const tools = toolRegistry.list()
  const allMessages = [...messages]
  let totalInputTokens = 0
  let totalOutputTokens = 0

  bus.emit("agent:start", undefined)

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (options.abortSignal?.aborted) break

      const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))

      const chatParams: ChatParams = {
        model: model.id,
        messages: allMessages,
        tools: toolDefs,
        systemPrompt: options.systemPrompt,
        maxTokens: model.maxOutput,
      }

      // Collect the streamed response
      let responseText = ""
      const toolCalls: ToolCall[] = []
      const pendingToolCall: Partial<ToolCall> & { inputJson?: string } = {}

      for await (const event of provider.chat(chatParams)) {
        if (options.abortSignal?.aborted) break
        bus.emit("stream:event", event)

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
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(pendingToolCall.inputJson || "{}")
              } catch {
                // If JSON parsing fails, pass raw string
                input = { raw: pendingToolCall.inputJson }
              }
              toolCalls.push({
                id: pendingToolCall.id ?? generateId(),
                name: pendingToolCall.name,
                input,
              })
            }
            // Reset
            pendingToolCall.id = undefined
            pendingToolCall.name = undefined
            pendingToolCall.inputJson = undefined
            break
          case "error":
            throw new Error(event.error ?? "Unknown streaming error")
        }
      }

      // Build the assistant message
      const assistantMessage: Message = {
        role: "assistant",
        content: responseText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }
      allMessages.push(assistantMessage)
      bus.emit("message:assistant", assistantMessage)

      // If no tool calls, we're done
      if (toolCalls.length === 0) break

      // Execute tool calls
      const toolResults = await executeToolCalls(toolCalls, {
        cwd: options.cwd,
        abortSignal: options.abortSignal,
        checkPermission: options.checkPermission,
      })

      // Add tool results as a message
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

    bus.emit("agent:done", undefined)
    return { messages: allMessages, totalInputTokens, totalOutputTokens }
  } catch (error) {
    bus.emit("agent:error", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext,
): Promise<Array<{ toolCallId: string; output: string; isError: boolean }>> {
  const results: Array<{ toolCallId: string; output: string; isError: boolean }> = []

  for (const call of toolCalls) {
    const tool = toolRegistry.get(call.name)
    if (!tool) {
      results.push({
        toolCallId: call.id,
        output: `Error: Unknown tool "${call.name}"`,
        isError: true,
      })
      continue
    }

    bus.emit("tool:start", { toolCallId: call.id, name: call.name, input: call.input })

    // Check permission if required
    if (tool.requiresPermission && context.checkPermission) {
      const allowed = await context.checkPermission(call.name, call.input)
      if (!allowed) {
        const output: ToolOutput = {
          output: "Permission denied by user.",
          isError: true,
        }
        bus.emit("tool:end", { toolCallId: call.id, name: call.name, output })
        results.push({ toolCallId: call.id, output: output.output, isError: true })
        continue
      }
    }

    try {
      const output = await tool.execute(call.input, context)
      bus.emit("tool:end", { toolCallId: call.id, name: call.name, output })
      results.push({ toolCallId: call.id, output: output.output, isError: output.isError })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const output: ToolOutput = { output: `Error: ${errorMsg}`, isError: true }
      bus.emit("tool:end", { toolCallId: call.id, name: call.name, output })
      results.push({ toolCallId: call.id, output: output.output, isError: true })
    }
  }

  return results
}
