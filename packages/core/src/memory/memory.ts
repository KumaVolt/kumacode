/**
 * Memory system — manages KUMACODE.md as persistent project memory.
 *
 * Supports:
 * - Reading project instructions from KUMACODE.md (via config.ts)
 * - Auto-learning conventions from conversations (LLM-based extraction)
 * - Manual memory management via /memory command
 * - User-scoped memory in ~/.kumacode/KUMACODE.md
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Message, Provider, ChatParams } from "../provider/base.js"

// Note: loadProjectInstructions is exported from config/config.ts directly.
// This module adds memory management capabilities on top of that.

const USER_MEMORY_DIR = join(homedir(), ".kumacode")
const USER_MEMORY_FILE = join(USER_MEMORY_DIR, "KUMACODE.md")

/**
 * Paths where project memory can be stored, in priority order.
 */
function getProjectMemoryPaths(cwd: string): string[] {
  return [
    join(cwd, "KUMACODE.md"),
    join(cwd, ".kumacode", "KUMACODE.md"),
  ]
}

/**
 * Read the user-level memory file (~/.kumacode/KUMACODE.md).
 */
export function readUserMemory(): string | null {
  try {
    if (existsSync(USER_MEMORY_FILE)) {
      return readFileSync(USER_MEMORY_FILE, "utf-8")
    }
  } catch {
    // Ignore read errors
  }
  return null
}

/**
 * Read the project-level memory file (KUMACODE.md or .kumacode/KUMACODE.md).
 * Returns the content and the path where it was found.
 */
export function readProjectMemory(cwd: string): { content: string; path: string } | null {
  for (const p of getProjectMemoryPaths(cwd)) {
    try {
      if (existsSync(p)) {
        return { content: readFileSync(p, "utf-8"), path: p }
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Append learnings to a KUMACODE.md file.
 * Creates the file if it doesn't exist.
 */
function appendToMemoryFile(filePath: string, learnings: string): void {
  const dir = join(filePath, "..")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  let existing = ""
  try {
    if (existsSync(filePath)) {
      existing = readFileSync(filePath, "utf-8")
    }
  } catch {
    // Start fresh
  }

  const timestamp = new Date().toISOString().split("T")[0] // YYYY-MM-DD
  const separator = existing.trim() ? "\n\n" : ""
  const entry = `${separator}## Learned ${timestamp}\n\n${learnings.trim()}\n`

  writeFileSync(filePath, existing + entry, "utf-8")
}

/**
 * Append learnings to the project memory file.
 * Uses the first existing path, or creates at .kumacode/KUMACODE.md.
 */
export function appendProjectMemory(cwd: string, learnings: string): string {
  const existing = readProjectMemory(cwd)
  const targetPath = existing?.path ?? join(cwd, "KUMACODE.md")
  appendToMemoryFile(targetPath, learnings)
  return targetPath
}

/**
 * Append learnings to the user memory file (~/.kumacode/KUMACODE.md).
 */
export function appendUserMemory(learnings: string): string {
  appendToMemoryFile(USER_MEMORY_FILE, learnings)
  return USER_MEMORY_FILE
}

/**
 * Use the LLM to extract learnings from a conversation.
 * Returns a concise set of conventions, patterns, and preferences discovered.
 * Returns null if the conversation has no extractable learnings.
 */
export async function extractLearnings(
  messages: Message[],
  provider: Provider,
  modelId: string,
): Promise<string | null> {
  // Only try to extract if there's substantial conversation
  if (messages.length < 4) return null

  // Serialize recent messages (skip tool result details to keep it short)
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const role = m.role.toUpperCase()
      const content = typeof m.content === "string"
        ? m.content.slice(0, 1500)
        : Array.isArray(m.content)
          ? m.content
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n")
              .slice(0, 1500)
          : ""
      return `${role}: ${content}`
    })
    .join("\n\n")
    .slice(0, 50_000) // Cap at 50k chars

  const prompt = [
    "Analyze this conversation between a user and a coding assistant.",
    "Extract any reusable learnings that would be useful for future conversations.",
    "",
    "Focus on:",
    "- Project conventions (naming, structure, patterns)",
    "- User preferences (code style, tool preferences, workflow)",
    "- Technical decisions (architecture choices, library choices)",
    "- Recurring commands or workflows",
    "- Important project details (directory structure, config)",
    "",
    "Rules:",
    "- Only extract CLEAR, CONCRETE learnings — not vague observations",
    "- Use bullet points, one per learning",
    "- Keep each point under 2 lines",
    "- If there are no meaningful learnings, respond with exactly: NONE",
    "- Do NOT include learnings about what was discussed — only reusable knowledge",
    "",
    "## Conversation:",
    "",
    transcript,
  ].join("\n")

  const params: ChatParams = {
    model: modelId,
    messages: [{ role: "user", content: prompt }],
    systemPrompt: "You extract reusable project conventions and learnings from conversations. Output bullet points or NONE.",
    maxTokens: 1024,
    temperature: 0.3,
  }

  let text = ""
  for await (const event of provider.chat(params)) {
    if (event.type === "text_delta" && event.text) {
      text += event.text
    }
    if (event.type === "error") {
      return null
    }
  }

  const trimmed = text.trim()
  if (!trimmed || trimmed === "NONE" || trimmed.length < 10) {
    return null
  }

  return trimmed
}

/**
 * Get a formatted view of all memory (user + project).
 */
export function getMemorySummary(cwd: string): string {
  const parts: string[] = []

  const userMem = readUserMemory()
  if (userMem) {
    parts.push(`## User Memory (~/.kumacode/KUMACODE.md)\n\n${userMem.trim()}`)
  }

  const projectMem = readProjectMemory(cwd)
  if (projectMem) {
    parts.push(`## Project Memory (${projectMem.path})\n\n${projectMem.content.trim()}`)
  }

  if (parts.length === 0) {
    return "No memory stored yet.\n\nKumaCode will learn conventions from your conversations and store them in KUMACODE.md."
  }

  return parts.join("\n\n---\n\n")
}
