/**
 * Skill system — discovers, parses, and manages skills.
 *
 * Skills are SKILL.md files with optional YAML frontmatter that extend
 * KumaCode's capabilities. They can be invoked by the user via /skill-name
 * or automatically by the LLM when relevant.
 *
 * Skill locations (in priority order):
 *   1. Personal:  ~/.kumacode/skills/<name>/SKILL.md
 *   2. Project:   .kumacode/skills/<name>/SKILL.md
 *
 * Frontmatter fields:
 *   name:                     Skill name (defaults to directory name)
 *   description:              When to use this skill (used by LLM for auto-invocation)
 *   argument-hint:            Hint for expected arguments (e.g. "[filename]")
 *   disable-model-invocation: true to prevent LLM from auto-invoking
 *   user-invocable:           false to hide from /slash menu
 *   allowed-tools:            Tools allowed when skill is active
 *   context:                  "fork" to run in a subagent
 *
 * String substitutions in skill content:
 *   $ARGUMENTS     — all arguments passed to the skill
 *   $ARGUMENTS[N]  — Nth argument (0-indexed)
 *   $N             — shorthand for $ARGUMENTS[N]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve, basename } from "node:path"
import { homedir } from "node:os"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name?: string
  description?: string
  "argument-hint"?: string
  "disable-model-invocation"?: boolean
  "user-invocable"?: boolean
  "allowed-tools"?: string
  context?: "fork"
  model?: string
}

export interface Skill {
  /** Unique skill name (lowercase, hyphens) */
  name: string
  /** Human-readable description for LLM context */
  description: string
  /** Raw markdown content (after frontmatter) */
  content: string
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter
  /** Absolute path to the SKILL.md file */
  filePath: string
  /** Source: "personal" | "project" */
  source: "personal" | "project"
  /** Directory containing SKILL.md (for supporting files) */
  directory: string
  /** Hint for expected arguments */
  argumentHint?: string
  /** Whether the LLM can auto-invoke this skill */
  modelInvocable: boolean
  /** Whether users can invoke via /name */
  userInvocable: boolean
}

// ─── Frontmatter parser (simple YAML subset) ────────────────────────────────

/**
 * Parse simple YAML frontmatter from a SKILL.md file.
 * Handles string, boolean, and number values. No nested objects or arrays.
 */
function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; content: string } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, content: raw }
  }

  const endIndex = trimmed.indexOf("---", 3)
  if (endIndex === -1) {
    return { frontmatter: {}, content: raw }
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const content = trimmed.slice(endIndex + 3).trim()
  const frontmatter: Record<string, unknown> = {}

  for (const line of yamlBlock.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value: unknown = line.slice(colonIndex + 1).trim()

    // Strip quotes
    if (typeof value === "string") {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = (value as string).slice(1, -1)
      } else if (value === "true") {
        value = true
      } else if (value === "false") {
        value = false
      } else if (/^\d+$/.test(value as string)) {
        value = parseInt(value as string, 10)
      }
    }

    frontmatter[key] = value
  }

  return { frontmatter: frontmatter as SkillFrontmatter, content }
}

// ─── Skill substitution ─────────────────────────────────────────────────────

/**
 * Apply $ARGUMENTS, $ARGUMENTS[N], and $N substitutions to skill content.
 */
export function applySubstitutions(content: string, args: string): string {
  const argParts = args.trim() ? args.trim().split(/\s+/) : []

  let result = content

  // Replace $ARGUMENTS[N] and shorthand $N
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index: string) => {
    const i = parseInt(index, 10)
    return argParts[i] ?? ""
  })
  result = result.replace(/\$(\d+)(?!\w)/g, (_match, index: string) => {
    const i = parseInt(index, 10)
    return argParts[i] ?? ""
  })

  // Replace $ARGUMENTS with all arguments
  result = result.replace(/\$ARGUMENTS/g, args.trim())

  return result
}

// ─── Skill discovery ────────────────────────────────────────────────────────

/**
 * Discover skills from a directory.
 * Looks for subdirectories containing SKILL.md.
 */
function discoverSkillsInDir(
  dir: string,
  source: "personal" | "project",
): Skill[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []

  const skills: Skill[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  for (const entry of entries) {
    const skillDir = join(dir, entry)
    const skillFile = join(skillDir, "SKILL.md")

    try {
      if (!statSync(skillDir).isDirectory()) continue
      if (!existsSync(skillFile)) continue

      const raw = readFileSync(skillFile, "utf-8")
      const { frontmatter, content } = parseFrontmatter(raw)

      const name = frontmatter.name ?? basename(skillDir)
      const description = frontmatter.description ?? extractFirstParagraph(content)

      skills.push({
        name,
        description,
        content,
        frontmatter,
        filePath: skillFile,
        source,
        directory: skillDir,
        argumentHint: frontmatter["argument-hint"],
        modelInvocable: frontmatter["disable-model-invocation"] !== true,
        userInvocable: frontmatter["user-invocable"] !== false,
      })
    } catch {
      // Skip malformed skills
    }
  }

  return skills
}

/**
 * Extract the first paragraph from markdown content for use as a description.
 */
function extractFirstParagraph(content: string): string {
  const lines = content.split("\n")
  const textLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip headings
    if (trimmed.startsWith("#")) continue
    // Stop at blank line after we've accumulated text
    if (!trimmed && textLines.length > 0) break
    if (trimmed) textLines.push(trimmed)
  }

  const paragraph = textLines.join(" ").slice(0, 250)
  return paragraph || "(no description)"
}

// ─── SkillRegistry ──────────────────────────────────────────────────────────

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()

  /** Load skills from all locations. Higher-priority sources overwrite lower. */
  loadAll(cwd: string): void {
    this.skills.clear()

    // 1. Project skills (lower priority)
    const projectDir = join(cwd, ".kumacode", "skills")
    for (const skill of discoverSkillsInDir(projectDir, "project")) {
      this.skills.set(skill.name, skill)
    }

    // 2. Personal skills (higher priority — overwrite project)
    const personalDir = join(homedir(), ".kumacode", "skills")
    for (const skill of discoverSkillsInDir(personalDir, "personal")) {
      this.skills.set(skill.name, skill)
    }
  }

  /** Get all loaded skills */
  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  /** Get skills that are user-invocable (for /slash menu) */
  listUserInvocable(): Skill[] {
    return this.list().filter((s) => s.userInvocable)
  }

  /** Get skills that the LLM can auto-invoke */
  listModelInvocable(): Skill[] {
    return this.list().filter((s) => s.modelInvocable)
  }

  /** Get a specific skill by name */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /** Check if a skill exists */
  has(name: string): boolean {
    return this.skills.has(name)
  }

  /** Get the count of loaded skills */
  get size(): number {
    return this.skills.size
  }

  /**
   * Build a context string for the system prompt listing available skills.
   * Only includes model-invocable skills with their descriptions truncated to 250 chars.
   */
  buildSystemPromptContext(): string | null {
    const invocable = this.listModelInvocable()
    if (invocable.length === 0) return null

    const lines = ["## Available Skills", ""]
    lines.push("You can invoke these skills using the Skill tool when relevant to the user's request:")
    lines.push("")

    for (const skill of invocable) {
      const desc = skill.description.slice(0, 250)
      lines.push(`- **${skill.name}**: ${desc}`)
    }

    return lines.join("\n")
  }

  /**
   * Resolve a skill invocation: apply argument substitutions, return full content.
   */
  resolve(name: string, args: string): string | null {
    const skill = this.skills.get(name)
    if (!skill) return null

    let content = skill.content

    // Apply $ARGUMENTS substitutions
    if (args.trim()) {
      content = applySubstitutions(content, args)
    } else if (!content.includes("$ARGUMENTS")) {
      // No args and no placeholder — content is used as-is
    }

    return content
  }
}

/** Global skill registry singleton */
export const skillRegistry = new SkillRegistry()
