// Git module — placeholder for git operations
// Phase 2: auto-commit, PR creation, diff display

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
