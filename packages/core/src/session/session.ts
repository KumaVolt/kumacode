import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { generateId } from "../util/id.js"
import type { Message } from "../provider/base.js"

export interface Session {
  id: string
  name: string | null
  model: string
  provider: string
  cwd: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionWithMessages extends Session {
  messages: Message[]
}

let db: Database | null = null

function getDb(): Database {
  if (db) return db

  const dir = join(homedir(), ".kumacode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(join(dir, "sessions.db"))
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_results TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

export function createSession(model: string, provider: string, cwd: string): Session {
  const id = generateId()
  const now = new Date().toISOString()
  getDb().run(
    "INSERT INTO sessions (id, model, provider, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, model, provider, cwd, now, now],
  )
  return { id, name: null, model, provider, cwd, createdAt: now, updatedAt: now, messageCount: 0 }
}

export function addMessage(sessionId: string, message: Message): void {
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content)
  getDb().run(
    "INSERT INTO messages (session_id, role, content, tool_calls, tool_results) VALUES (?, ?, ?, ?, ?)",
    [
      sessionId,
      message.role,
      content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
    ],
  )
  getDb().run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [sessionId])
}

export function getSession(id: string): SessionWithMessages | null {
  const row = getDb().query("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, string> | null
  if (!row) return null

  const msgRows = getDb()
    .query("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(id) as Array<Record<string, string>>

  const messages: Message[] = msgRows.map((r) => {
    let content: string | Message["content"]
    try {
      content = JSON.parse(r.content)
    } catch {
      content = r.content
    }
    return {
      role: r.role as Message["role"],
      content,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolResults: r.tool_results ? JSON.parse(r.tool_results) : undefined,
    }
  })

  const msgCount = getDb()
    .query("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
    .get(id) as { count: number }

  return {
    id: row.id,
    name: row.name,
    model: row.model,
    provider: row.provider,
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: msgCount.count,
    messages,
  }
}

export function listSessions(limit = 20): Session[] {
  const rows = getDb()
    .query(
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
       FROM sessions s ORDER BY s.updated_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, string | number>>

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string | null,
    model: r.model as string,
    provider: r.provider as string,
    cwd: r.cwd as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    messageCount: r.message_count as number,
  }))
}

export function getMostRecentSession(): Session | null {
  const sessions = listSessions(1)
  return sessions[0] ?? null
}

export function deleteSession(id: string): void {
  getDb().run("DELETE FROM messages WHERE session_id = ?", [id])
  getDb().run("DELETE FROM sessions WHERE id = ?", [id])
}

/**
 * Update the name of an existing session.
 */
export function updateSessionName(id: string, name: string): void {
  getDb().run("UPDATE sessions SET name = ? WHERE id = ?", [name, id])
}

/**
 * Generate a short session name from the first user message.
 * Strips @file mention blocks, takes first ~50 chars trimmed to a word boundary.
 */
export function generateSessionName(firstUserMessage: string): string {
  // Strip inline file attachment blocks (--- @path --- ... --- end @path ---)
  let text = firstUserMessage.replace(/\n\n--- @[\s\S]*?--- end @[^\n]* ---/g, "")
  // Also strip trailing single-line attachment notes
  text = text.replace(/\n\n--- @[^\n]* ---$/g, "")
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim()

  if (!text) return "Untitled"

  // Take first 50 characters, trim to last word boundary
  if (text.length <= 50) return text
  const truncated = text.slice(0, 50)
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > 20) {
    return truncated.slice(0, lastSpace) + "..."
  }
  return truncated + "..."
}
