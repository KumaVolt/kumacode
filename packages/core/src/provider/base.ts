import type { z } from "zod"

export interface Message {
  role: "user" | "assistant" | "system"
  content: string | ContentBlock[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ImageSource {
  type: "base64" | "url"
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  /** Base64-encoded data (when type === "base64") */
  data?: string
  /** URL of the image (when type === "url") */
  url?: string
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image"
  text?: string
  toolCallId?: string
  toolName?: string
  input?: Record<string, unknown>
  output?: string
  isError?: boolean
  /** Image source data (when type === "image") */
  imageSource?: ImageSource
  /** Human-readable label for the image (filename, description, etc.) */
  imageLabel?: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  output: string
  isError: boolean
}

export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done" | "error"
  text?: string
  toolCall?: Partial<ToolCall>
  error?: string
}

export interface ProviderConfig {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  models: ModelConfig[]
}

export interface ModelConfig {
  id: string
  name: string
  contextWindow: number
  maxOutput: number
  supportsToolUse: boolean
  supportsStreaming: boolean
  supportsVision?: boolean
  inputPricePer1M?: number
  outputPricePer1M?: number
}

export interface Provider {
  readonly config: ProviderConfig

  chat(params: ChatParams): AsyncIterable<StreamEvent>

  listModels(): Promise<ModelConfig[]>
}

export interface ChatParams {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodType
}
