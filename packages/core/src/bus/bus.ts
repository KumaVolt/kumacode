import mitt from "mitt"
import type { Message, StreamEvent, ModelConfig } from "../provider/base.js"
import type { ToolOutput } from "../tool/base.js"

export type BusEvents = {
  /** Streaming text/tool events from the LLM */
  "stream:event": StreamEvent
  /** A complete assistant message has been received */
  "message:assistant": Message
  /** User sent a message */
  "message:user": Message
  /** Tool execution started */
  "tool:start": { toolCallId: string; name: string; input: Record<string, unknown> }
  /** Tool execution completed */
  "tool:end": { toolCallId: string; name: string; output: ToolOutput }
  /** Permission request for a tool */
  "permission:request": {
    toolCallId: string
    name: string
    input: Record<string, unknown>
    resolve: (allowed: boolean) => void
  }
  /** Agent loop started */
  "agent:start": undefined
  /** Agent loop completed */
  "agent:done": undefined
  /** Agent loop error */
  "agent:error": Error
  /** Model changed */
  "model:changed": ModelConfig
  /** Cost update */
  "cost:update": { inputTokens: number; outputTokens: number; cost: number; totalCost: number }
  /** Session event */
  "session:created": { id: string }
  "session:resumed": { id: string }
}

export const bus = mitt<BusEvents>()
export type Bus = typeof bus
