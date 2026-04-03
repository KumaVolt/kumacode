/**
 * OpenAI-compatible provider base.
 * Used by: OpenAI, GitHub Copilot, Ollama, and any OpenAI-compatible endpoint.
 *
 * Each provider subclass just configures the base URL, auth, and model list.
 * The actual chat/streaming logic is shared.
 */
import OpenAI from "openai"
import { zodToJsonSchema } from "./schema-convert.js"
import type {
  Provider,
  ProviderConfig,
  ModelConfig,
  ChatParams,
  StreamEvent,
  Message,
  ContentBlock,
  ToolDefinition,
} from "./base.js"

export interface OpenAIProviderOptions {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
  models: ModelConfig[]
  defaultHeaders?: Record<string, string>
}

export class OpenAICompatibleProvider implements Provider {
  readonly config: ProviderConfig
  protected client: OpenAI

  constructor(options: OpenAIProviderOptions) {
    this.config = {
      id: options.id,
      name: options.name,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      models: options.models,
    }

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      defaultHeaders: options.defaultHeaders,
    })
  }

  async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
    const messages = this.convertMessages(params)
    const tools = params.tools ? this.convertTools(params.tools) : undefined

    try {
      const stream = await this.client.chat.completions.create({
        model: params.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stream: true,
      })

      let hasActiveToolCall = false

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue

        const delta = choice.delta

        // Text content
        if (delta.content) {
          yield { type: "text_delta", text: delta.content }
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              // A new tool call is starting — close any previous one
              if (hasActiveToolCall) {
                yield { type: "tool_call_end" }
              }
              hasActiveToolCall = true
              yield {
                type: "tool_call_start",
                toolCall: {
                  id: tc.id,
                  name: tc.function?.name ?? "",
                },
              }
            }
            if (tc.function?.arguments) {
              yield {
                type: "tool_call_delta",
                text: tc.function.arguments,
              }
            }
          }
        }

        // Check for finish — close any pending tool call
        if (choice.finish_reason) {
          if (hasActiveToolCall) {
            yield { type: "tool_call_end" }
            hasActiveToolCall = false
          }
        }
      }

      // Safety: if stream ends without finish_reason, close any pending tool call
      if (hasActiveToolCall) {
        yield { type: "tool_call_end" }
      }

      yield { type: "done" }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: "error", error: message }
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    try {
      const response = await this.client.models.list()
      return response.data.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: 128000,
        maxOutput: 4096,
        supportsToolUse: true,
        supportsStreaming: true,
      }))
    } catch {
      // Fall back to configured models
      return this.config.models
    }
  }

  /**
   * Convert our Message format to OpenAI's format.
   */
  private convertMessages(
    params: ChatParams,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

    // System prompt
    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt })
    }

    for (const msg of params.messages) {
      if (msg.role === "system") {
        messages.push({
          role: "system",
          content: typeof msg.content === "string" ? msg.content : this.flattenContent(msg.content),
        })
      } else if (msg.role === "user") {
        // Check if this is a tool result message
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const result of msg.toolResults) {
            messages.push({
              role: "tool",
              tool_call_id: result.toolCallId,
              content: result.output,
            })
          }
        } else if (Array.isArray(msg.content)) {
          // Check for tool_result content blocks
          const blocks = msg.content as ContentBlock[]
          const toolResults = blocks.filter(
            (b) => b.type === "tool_result",
          )
          if (toolResults.length > 0) {
            for (const block of toolResults) {
              messages.push({
                role: "tool",
                tool_call_id: block.toolCallId ?? "",
                content: block.output ?? "",
              })
            }
          } else {
            // Check if there are image blocks — if so, use multi-part content
            const hasImages = blocks.some((b) => b.type === "image")
            if (hasImages) {
              const parts: Array<
                | { type: "text"; text: string }
                | { type: "image_url"; image_url: { url: string; detail?: string } }
              > = []
              for (const block of blocks) {
                if (block.type === "text" && block.text) {
                  parts.push({ type: "text", text: block.text })
                } else if (block.type === "image" && block.imageSource) {
                  const url = block.imageSource.type === "base64"
                    ? `data:${block.imageSource.mediaType};base64,${block.imageSource.data}`
                    : block.imageSource.url ?? ""
                  parts.push({
                    type: "image_url",
                    image_url: { url, detail: "auto" },
                  })
                }
              }
              messages.push({
                role: "user",
                content: parts,
              } as OpenAI.Chat.Completions.ChatCompletionMessageParam)
            } else {
              messages.push({
                role: "user",
                content: this.flattenContent(blocks),
              })
            }
          }
        } else {
          messages.push({
            role: "user",
            content: msg.content as string,
          })
        }
      } else if (msg.role === "assistant") {
        const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: "assistant",
        }

        if (typeof msg.content === "string" && msg.content) {
          assistantMsg.content = msg.content
        }

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          }))
        }

        messages.push(assistantMsg)
      }
    }

    return messages
  }

  /**
   * Convert our ToolDefinition format to OpenAI's format.
   */
  private convertTools(
    tools: ToolDefinition[],
  ): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }))
  }

  private flattenContent(blocks: ContentBlock[]): string {
    return blocks
      .map((b) => b.text ?? b.output ?? "")
      .filter(Boolean)
      .join("\n")
  }
}
