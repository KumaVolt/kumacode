import type { Message } from "../provider/base.js"

/**
 * Manages the context window — tracks token usage and handles compaction
 * when approaching the model's context limit.
 */
export interface ContextManager {
  /** Estimate token count for messages */
  estimateTokens(messages: Message[]): number
  /** Compact messages when approaching context limit */
  compact(messages: Message[], maxTokens: number): Promise<Message[]>
}

/**
 * Simple token estimator — roughly 4 characters per token.
 * Good enough for context window management. Not for billing.
 */
export function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        chars += (block.text ?? "").length
        chars += (block.output ?? "").length
        if (block.input) chars += JSON.stringify(block.input).length
      }
    }
    if (msg.toolCalls) {
      chars += JSON.stringify(msg.toolCalls).length
    }
    if (msg.toolResults) {
      chars += JSON.stringify(msg.toolResults).length
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * Basic compaction strategy: summarize older messages, keep recent ones intact.
 * For MVP, we just truncate old messages and prepend a summary note.
 */
export async function compactMessages(
  messages: Message[],
  maxTokens: number,
): Promise<Message[]> {
  const currentTokens = estimateTokens(messages)
  if (currentTokens <= maxTokens) return messages

  // Keep the system prompt (first message if system) and recent messages
  const keepRecent = Math.min(10, messages.length)
  const recent = messages.slice(-keepRecent)
  const older = messages.slice(0, -keepRecent)

  if (older.length === 0) return messages

  // Create a summary placeholder for older messages
  const summaryMessage: Message = {
    role: "system",
    content: `[Context compacted: ${older.length} earlier messages were summarized to fit the context window. The conversation has been ongoing with file edits and tool usage.]`,
  }

  return [summaryMessage, ...recent]
}
