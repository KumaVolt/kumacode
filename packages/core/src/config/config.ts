import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { SettingsSchema, type Settings } from "./schema.js"

const USER_CONFIG_DIR = join(homedir(), ".kumacode")
const USER_SETTINGS_FILE = join(USER_CONFIG_DIR, "settings.json")
const PROJECT_CONFIG_DIR = ".kumacode"
const PROJECT_SETTINGS_FILE = "settings.json"
const PROJECT_LOCAL_SETTINGS_FILE = "settings.local.json"

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    if (
      result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) &&
      override[key] && typeof override[key] === "object" && !Array.isArray(override[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, override[key] as Record<string, unknown>)
    } else {
      result[key] = override[key]
    }
  }
  return result
}

/**
 * Load settings with the scope hierarchy:
 * User (lowest) → Project → Local (highest)
 */
export function loadSettings(cwd: string): Settings {
  let merged: Record<string, unknown> = {}

  // User settings (~/.kumacode/settings.json)
  const userSettings = readJsonFile(USER_SETTINGS_FILE)
  if (userSettings) merged = deepMerge(merged, userSettings)

  // Project settings (.kumacode/settings.json)
  const projectSettingsPath = join(cwd, PROJECT_CONFIG_DIR, PROJECT_SETTINGS_FILE)
  const projectSettings = readJsonFile(projectSettingsPath)
  if (projectSettings) merged = deepMerge(merged, projectSettings)

  // Local settings (.kumacode/settings.local.json)
  const localSettingsPath = join(cwd, PROJECT_CONFIG_DIR, PROJECT_LOCAL_SETTINGS_FILE)
  const localSettings = readJsonFile(localSettingsPath)
  if (localSettings) merged = deepMerge(merged, localSettings)

  return SettingsSchema.parse(merged)
}

/**
 * Save settings to user scope.
 */
export function saveUserSettings(settings: Partial<Settings>): void {
  if (!existsSync(USER_CONFIG_DIR)) {
    mkdirSync(USER_CONFIG_DIR, { recursive: true })
  }
  const existing = readJsonFile(USER_SETTINGS_FILE) ?? {}
  const merged = deepMerge(existing, settings as Record<string, unknown>)
  writeFileSync(USER_SETTINGS_FILE, JSON.stringify(merged, null, 2) + "\n")
}

/**
 * Save settings to project scope.
 */
export function saveProjectSettings(cwd: string, settings: Partial<Settings>): void {
  const dir = join(cwd, PROJECT_CONFIG_DIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const filePath = join(dir, PROJECT_SETTINGS_FILE)
  const existing = readJsonFile(filePath) ?? {}
  const merged = deepMerge(existing, settings as Record<string, unknown>)
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n")
}

/**
 * Get the path to the user config directory.
 */
export function getUserConfigDir(): string {
  return USER_CONFIG_DIR
}

/**
 * Load KUMACODE.md instructions from project root.
 */
export function loadProjectInstructions(cwd: string): string | null {
  const paths = [
    join(cwd, "KUMACODE.md"),
    join(cwd, ".kumacode", "KUMACODE.md"),
  ]
  for (const p of paths) {
    try {
      if (existsSync(p)) return readFileSync(p, "utf-8")
    } catch {
      continue
    }
  }
  return null
}
