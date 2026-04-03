// Git module — git status, diff, log helpers for context injection.

import { execSync } from "node:child_process"

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

export function getGitBranch(cwd: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: "pipe" }).toString().trim()
  } catch {
    return null
  }
}

export function getGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe" }).toString().trim()
  } catch {
    return null
  }
}

/**
 * Short working-tree status (porcelain format).
 * Returns lines like "M  src/foo.ts", "?? new-file.ts", etc.
 * Truncates to `maxLines` so the system prompt stays manageable.
 */
export function getGitStatus(cwd: string, maxLines = 30): string | null {
  try {
    const raw = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim()
    if (!raw) return null
    const lines = raw.split("\n")
    if (lines.length <= maxLines) return raw
    return lines.slice(0, maxLines).join("\n") + `\n... and ${lines.length - maxLines} more files`
  } catch {
    return null
  }
}

/**
 * Diff stat of unstaged changes (compact --stat format).
 * Falls back to full diff truncated to `maxChars` if --stat is empty.
 */
export function getGitDiff(cwd: string, maxChars = 2000): string | null {
  try {
    // Try stat first — it's compact
    const stat = execSync("git diff --stat", { cwd, stdio: "pipe" }).toString().trim()
    if (stat) return stat.length <= maxChars ? stat : stat.slice(0, maxChars) + "\n... (truncated)"

    return null
  } catch {
    return null
  }
}

/**
 * Diff stat of staged changes.
 */
export function getGitStagedDiff(cwd: string, maxChars = 2000): string | null {
  try {
    const stat = execSync("git diff --cached --stat", { cwd, stdio: "pipe" }).toString().trim()
    if (stat) return stat.length <= maxChars ? stat : stat.slice(0, maxChars) + "\n... (truncated)"
    return null
  } catch {
    return null
  }
}

/**
 * Recent commit log (oneline format).
 */
export function getGitRecentCommits(cwd: string, n = 5): string | null {
  try {
    const log = execSync(`git log --oneline -n ${n}`, { cwd, stdio: "pipe" }).toString().trim()
    return log || null
  } catch {
    return null
  }
}
