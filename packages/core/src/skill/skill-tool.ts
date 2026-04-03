/**
 * Skill tool — lets the LLM invoke a named skill.
 *
 * When the LLM determines a skill is relevant, it calls this tool with
 * the skill name and optional arguments. The skill content (with argument
 * substitutions applied) is returned as the tool output, which the LLM
 * then uses to guide its behavior.
 *
 * Does not require permission — skills are read-only prompt injections.
 */
import { z } from "zod"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "../tool/base.js"
import { skillRegistry } from "./skill.js"

export const SkillInputSchema = z.object({
  name: z.string().describe("The name of the skill to invoke"),
  arguments: z.string().optional().describe("Arguments to pass to the skill"),
})

export const skillTool: Tool = {
  name: "Skill",
  description:
    "Invoke a skill by name to get specialized instructions or context. " +
    "Skills provide domain-specific knowledge, workflows, and conventions. " +
    "Use this when a task matches an available skill's description.",
  inputSchema: SkillInputSchema,
  requiresPermission: false,

  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const parsed = SkillInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { name, arguments: args = "" } = parsed.data
    const skill = skillRegistry.get(name)

    if (!skill) {
      const available = skillRegistry.listModelInvocable().map((s) => s.name)
      return {
        output: `Skill "${name}" not found. Available skills: ${available.length > 0 ? available.join(", ") : "(none)"}`,
        isError: true,
      }
    }

    if (!skill.modelInvocable) {
      return {
        output: `Skill "${name}" is not available for model invocation. It can only be invoked by the user via /${name}.`,
        isError: true,
      }
    }

    const content = skillRegistry.resolve(name, args)
    if (!content) {
      return { output: `Failed to resolve skill "${name}"`, isError: true }
    }

    return {
      output: `[Skill: ${name}]\n\n${content}`,
      isError: false,
      metadata: { skillName: name, source: skill.source },
    }
  },
}
