import type { PermissionMode } from "./modes.js"
import { PERMISSION_MODE_CONFIGS } from "./modes.js"
import type { Permissions } from "../config/schema.js"
import type { PermissionLevel } from "../tool/base.js"

/**
 * Evaluate whether a tool invocation is allowed, denied, or needs to ask.
 */
export function evaluatePermission(
  toolName: string,
  _input: Record<string, unknown>,
  mode: PermissionMode,
  rules: Permissions,
): PermissionLevel {
  const modeConfig = PERMISSION_MODE_CONFIGS[mode]

  // Check if tool is blocked in this mode
  if (modeConfig.blocked.includes(toolName)) return "denied"

  // Check explicit deny rules
  for (const rule of rules.deny) {
    if (matchesRule(toolName, _input, rule)) return "denied"
  }

  // Check explicit allow rules
  for (const rule of rules.allow) {
    if (matchesRule(toolName, _input, rule)) return "allowed"
  }

  // Check if auto-allowed in this mode
  if (modeConfig.autoAllow.includes(toolName)) return "allowed"

  // Default: ask
  return "ask"
}

/**
 * Match a tool invocation against a permission rule string.
 * Rules look like: "Bash(npm run test *)" or "Read(./.env)"
 */
function matchesRule(
  toolName: string,
  input: Record<string, unknown>,
  rule: string,
): boolean {
  // Simple format: "ToolName" or "ToolName(pattern)"
  const match = rule.match(/^(\w+)(?:\((.+)\))?$/)
  if (!match) return false

  const [, ruleTool, rulePattern] = match
  if (ruleTool !== toolName) return false
  if (!rulePattern) return true

  // Match the pattern against input values
  const inputStr = Object.values(input).join(" ")
  return globMatch(rulePattern, inputStr)
}

/**
 * Basic glob matching with * wildcard.
 */
function globMatch(pattern: string, str: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "*" ? ".*" : "\\" + m)) + "$",
  )
  return regex.test(str)
}
