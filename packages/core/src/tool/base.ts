import type { z } from "zod"

export interface ToolContext {
  cwd: string
  abortSignal?: AbortSignal
  /** Callback to ask the user a question from within a tool */
  askUser?: (question: string) => Promise<string>
  /** Callback to check permission before executing */
  checkPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export interface ToolInput {
  [key: string]: unknown
}

export interface ToolOutput {
  output: string
  isError: boolean
  /** Optional metadata (e.g., file paths affected, bytes read) */
  metadata?: Record<string, unknown>
}

export interface Tool {
  /** Unique name matching what the LLM calls */
  name: string
  /** Human-readable description for the LLM */
  description: string
  /** Zod schema for input validation */
  inputSchema: z.ZodType
  /** Whether this tool requires permission before executing */
  requiresPermission: boolean
  /** Execute the tool */
  execute(input: ToolInput, context: ToolContext): Promise<ToolOutput>
}

/** Permission level for a tool invocation */
export type PermissionLevel = "allowed" | "denied" | "ask"
