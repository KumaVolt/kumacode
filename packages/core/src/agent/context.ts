import type { Message, Provider, ChatParams, StreamEvent } from "../provider/base.js"
import { bus } from "../bus/bus.js"

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

export interface CompactOptions {
  /** Provider + model to use for LLM-based summarization */
  provider?: Provider
  modelId?: string
}

/**
 * Compact messages when approaching the context window limit.
 *
 * Strategy:
 * 1. Keep the most recent N messages intact (preserves current working context).
 * 2. Serialize the older messages into a text representation.
 * 3. If a provider is available, ask the LLM to produce a concise summary.
 * 4. If no provider or the LLM call fails, fall back to a simple placeholder.
 * 5. Return [summary system message, ...recent messages].
 */
export async function compactMessages(
  messages: Message[],
  maxTokens: number,
  options?: CompactOptions,
): Promise<Message[]> {
  const currentTokens = estimateTokens(messages)
  if (currentTokens <= maxTokens) return messages

  // Keep the system prompt (first message if system) and recent messages
  const keepRecent = Math.min(10, messages.length)
  const recent = messages.slice(-keepRecent)
  const older = messages.slice(0, -keepRecent)

  if (older.length === 0) return messages

  // Attempt LLM-based summarization
  if (options?.provider && options?.modelId) {
    try {
      const summary = await summarizeWithLLM(older, options.provider, options.modelId)
      if (summary) {
        bus.emit("context:compacted", { removedCount: older.length, method: "llm" })
        const summaryMessage: Message = {
          role: "system",
          content: `[Context compacted — LLM summary of ${older.length} earlier messages]\n\n${summary}`,
        }
        return [summaryMessage, ...recent]
      }
    } catch {
      // Fall through to naive compaction
    }
  }

  // Fallback: naive placeholder
  bus.emit("context:compacted", { removedCount: older.length, method: "truncate" })
  const summaryMessage: Message = {
    role: "system",
    content: `[Context compacted: ${older.length} earlier messages were removed to fit the context window. The conversation has been ongoing with file edits and tool usage.]`,
  }

  return [summaryMessage, ...recent]
}

/**
 * Use the LLM to produce a concise summary of older messages.
 * Returns the summary text, or null if it fails.
 */
async function summarizeWithLLM(
  messages: Message[],
  provider: Provider,
  modelId: string,
): Promise<string | null> {
  // Serialize older messages into a readable transcript
  const transcript = serializeMessagesForSummary(messages)

  // Cap transcript at ~100k chars to avoid blowing up the summarization call itself
  const maxTranscriptChars = 100_000
  const trimmedTranscript = transcript.length > maxTranscriptChars
    ? transcript.slice(0, maxTranscriptChars) + "\n\n[...transcript truncated...]"
    : transcript

  const summaryPrompt =
    "You are a conversation summarizer. Produce a concise summary of the following conversation " +
    "between a user and an AI coding assistant. Preserve:\n" +
    "- Key decisions made\n" +
    "- File paths and code changes mentioned\n" +
    "- Current state of work (what's done, what's pending)\n" +
    "- Any errors encountered and their resolutions\n" +
    "- Important context the assistant would need to continue the conversation\n\n" +
    "Be concise but thorough — aim for ~500 words.\n\n" +
    "## Conversation transcript:\n\n" +
    trimmedTranscript

  const params: ChatParams = {
    model: modelId,
    messages: [{ role: "user", content: summaryPrompt }],
    systemPrompt: "You are a concise conversation summarizer. Output only the summary, no preamble.",
    maxTokens: 2048,
    temperature: 0.3,
  }

  // Collect the full response without emitting stream events to the UI
  let text = ""
  for await (const event of provider.chat(params)) {
    if (event.type === "text_delta" && event.text) {
      text += event.text
    }
    if (event.type === "error") {
      return null
    }
  }

  return text.trim() || null
}

/**
 * Serialize messages into a human-readable transcript for summarization.
 */
function serializeMessagesForSummary(messages: Message[]): string {
  const lines: string[] = []

  for (const msg of messages) {
    const role = msg.role.toUpperCase()
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .map((b) => {
              if (b.type === "tool_result") {
                return `[Tool result for ${b.toolCallId}: ${b.isError ? "ERROR: " : ""}${(b.output ?? "").slice(0, 500)}]`
              }
              return b.text ?? b.output ?? ""
            })
            .filter(Boolean)
            .join("\n")
        : ""

    if (content) {
      lines.push(`${role}: ${content.slice(0, 2000)}`)
    }

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const inputStr = JSON.stringify(tc.input).slice(0, 500)
        lines.push(`  [Tool call: ${tc.name}(${inputStr})]`)
      }
    }
  }

  return lines.join("\n\n")
}
