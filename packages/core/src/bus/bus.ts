import mitt from "mitt"
import type { Message, StreamEvent, ModelConfig } from "../provider/base.js"
import type { ToolOutput } from "../tool/base.js"
import type { UpdateInfo } from "../update/update.js"

/** Represents a file modification that can be undone */
export interface FileBackup {
  /** Absolute path of the modified file */
  filePath: string
  /** Previous content (null if the file was newly created) */
  previousContent: string | null
  /** Timestamp of the modification */
  timestamp: number
  /** Which tool made the change */
  toolName: string
}

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
  /** File mentions expanded */
  "file:attached": { paths: string[] }
  /** Context was compacted */
  "context:compacted": { removedCount: number; method: string }
  /** File was modified by a tool (for undo support) */
  "file:modified": FileBackup
  /** Sub-agent started */
  "subagent:start": { taskId: string; description: string }
  /** Sub-agent finished */
  "subagent:end": { taskId: string; description: string; success: boolean }
  /** Sub-agent tool activity (for TUI indicators) */
  "subagent:tool": {
    taskId: string
    toolCallId: string
    name: string
    input: Record<string, unknown>
    status: "start" | "done" | "error" | "denied"
  }
  /** A newer version is available */
  "update:available": UpdateInfo
  /** Self-update started */
  "update:start": undefined
  /** Self-update completed */
  "update:done": { success: boolean; output: string; previousVersion: string; newVersion: string | null }
}

export const bus = mitt<BusEvents>()
export type Bus = typeof bus
