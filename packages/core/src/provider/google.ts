/**
 * Google Gemini provider.
 *
 * Uses the @google/generative-ai SDK directly (not OpenAI-compatible)
 * because Gemini's tool calling format differs from OpenAI's.
 */
import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration, SchemaType } from "@google/generative-ai"
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
import { zodToJsonSchema } from "./schema-convert.js"
import { generateId } from "../util/id.js"

const GEMINI_MODELS: ModelConfig[] = [
  {
    id: "gemini-2.5-pro-preview-05-06",
    name: "Gemini 2.5 Pro",
    contextWindow: 1048576,
    maxOutput: 65536,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 1.25,
    outputPricePer1M: 10.0,
  },
  {
    id: "gemini-2.5-flash-preview-05-20",
    name: "Gemini 2.5 Flash",
    contextWindow: 1048576,
    maxOutput: 65536,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    contextWindow: 1048576,
    maxOutput: 8192,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
  },
]

export class GoogleProvider implements Provider {
  readonly config: ProviderConfig
  private genAI: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.config = {
      id: "google",
      name: "Google Gemini",
      apiKey,
      models: GEMINI_MODELS,
    }
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
    const model = this.genAI.getGenerativeModel({
      model: params.model,
      systemInstruction: params.systemPrompt,
    })

    const contents = this.convertMessages(params.messages)
    const tools = params.tools ? this.convertTools(params.tools) : undefined

    try {
      const result = await model.generateContentStream({
        contents,
        tools: tools ? [{ functionDeclarations: tools }] : undefined,
        generationConfig: {
          maxOutputTokens: params.maxTokens,
          temperature: params.temperature,
        },
      })

      for await (const chunk of result.stream) {
        const candidate = chunk.candidates?.[0]
        if (!candidate?.content?.parts) continue

        for (const part of candidate.content.parts) {
          if (part.text) {
            yield { type: "text_delta", text: part.text }
          }

          if (part.functionCall) {
            const id = generateId()
            yield {
              type: "tool_call_start",
              toolCall: {
                id,
                name: part.functionCall.name,
              },
            }
            yield {
              type: "tool_call_delta",
              text: JSON.stringify(part.functionCall.args ?? {}),
            }
            yield { type: "tool_call_end" }
          }
        }
      }

      yield { type: "done" }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: "error", error: message }
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    return this.config.models
  }

  private convertMessages(messages: Message[]): Content[] {
    const contents: Content[] = []

    for (const msg of messages) {
      if (msg.role === "system") continue // Handled via systemInstruction

      if (msg.role === "user") {
        // Check for tool results
        if (msg.toolResults && msg.toolResults.length > 0) {
          const parts: Part[] = msg.toolResults.map((r) => ({
            functionResponse: {
              name: r.toolCallId, // Gemini uses name, we'll map this
              response: { result: r.output },
            },
          }))
          contents.push({ role: "user", parts })
        } else if (Array.isArray(msg.content)) {
          const blocks = msg.content as ContentBlock[]
          // Check for image blocks
          const hasImages = blocks.some((b) => b.type === "image")
          if (hasImages) {
            const parts: Part[] = []
            for (const block of blocks) {
              if (block.type === "text" && block.text) {
                parts.push({ text: block.text })
              } else if (block.type === "image" && block.imageSource) {
                if (block.imageSource.type === "base64" && block.imageSource.data) {
                  parts.push({
                    inlineData: {
                      mimeType: block.imageSource.mediaType,
                      data: block.imageSource.data,
                    },
                  })
                }
                // URL-based images not directly supported by Gemini SDK inline —
                // would need to download first. Skip for now.
              }
            }
            if (parts.length > 0) {
              contents.push({ role: "user", parts })
            }
          } else {
            const text = blocks
              .map((b) => b.text ?? b.output ?? "")
              .filter(Boolean)
              .join("\n")
            contents.push({ role: "user", parts: [{ text }] })
          }
        } else {
          const text = msg.content as string
          contents.push({ role: "user", parts: [{ text }] })
        }
      } else if (msg.role === "assistant") {
        const parts: Part[] = []

        if (typeof msg.content === "string" && msg.content) {
          parts.push({ text: msg.content })
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.input,
              },
            })
          }
        }

        if (parts.length > 0) {
          contents.push({ role: "model", parts })
        }
      }
    }

    return contents
  }

  private convertTools(tools: ToolDefinition[]): FunctionDeclaration[] {
    return tools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.inputSchema)
      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: SchemaType.OBJECT,
          properties: (jsonSchema.properties ?? {}) as Record<string, any>,
          required: jsonSchema.required as string[] | undefined,
        },
      }
    })
  }
}

export function createGoogleProvider(apiKey: string) {
  return new GoogleProvider(apiKey)
}
