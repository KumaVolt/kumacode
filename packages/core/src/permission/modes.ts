export type PermissionMode = "default" | "acceptEdits" | "plan"

export const PERMISSION_MODES: PermissionMode[] = ["default", "acceptEdits", "plan"]

export interface PermissionModeConfig {
  name: string
  description: string
  /** Tools that require no permission in this mode */
  autoAllow: string[]
  /** Tools that are blocked in this mode */
  blocked: string[]
}

export const PERMISSION_MODE_CONFIGS: Record<PermissionMode, PermissionModeConfig> = {
  default: {
    name: "Default",
    description: "Ask permission for file writes and command execution",
    autoAllow: ["Read", "Glob", "Grep", "AskUser"],
    blocked: [],
  },
  acceptEdits: {
    name: "Accept Edits",
    description: "Auto-approve file edits, still ask for commands",
    autoAllow: ["Read", "Glob", "Grep", "AskUser", "Write", "Edit"],
    blocked: [],
  },
  plan: {
    name: "Plan",
    description: "Read-only mode — no file writes or command execution",
    autoAllow: ["Read", "Glob", "Grep", "AskUser"],
    blocked: ["Write", "Edit", "Bash"],
  },
}

/**
 * Cycle to the next permission mode.
 */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const idx = PERMISSION_MODES.indexOf(current)
  return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]
}
