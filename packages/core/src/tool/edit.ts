/**
 * Edit tool — targeted search-and-replace edits in files.
 * Requires permission. Emits file:modified for undo support.
 */
import { z } from "zod"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"
import { resolvePath, isWithinCwd } from "../util/path.js"
import { generateDiff } from "../util/diff.js"
import { bus } from "../bus/bus.js"

export const EditInputSchema = z.object({
  filePath: z.string().describe("The absolute or relative path to the file to edit"),
  oldString: z.string().describe("The exact text to find and replace"),
  newString: z.string().describe("The replacement text"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace all occurrences (default false, replace first only)"),
})

export const editTool: Tool = {
  name: "Edit",
  description:
    "Make targeted edits to a file using search-and-replace. " +
    "Provide the exact text to find (oldString) and the replacement text (newString). " +
    "The edit fails if oldString is not found or matches multiple times (unless replaceAll is true).",
  inputSchema: EditInputSchema,
  requiresPermission: true,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = EditInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { filePath, oldString, newString, replaceAll = false } = parsed.data
    const resolved = resolvePath(context.cwd, filePath)

    if (!isWithinCwd(context.cwd, filePath)) {
      return { output: `Error: Path "${filePath}" is outside the working directory`, isError: true }
    }

    if (!existsSync(resolved)) {
      return { output: `Error: File "${filePath}" does not exist`, isError: true }
    }

    if (oldString === newString) {
      return { output: `Error: oldString and newString are identical`, isError: true }
    }

    try {
      const content = readFileSync(resolved, "utf-8")

      if (!content.includes(oldString)) {
        return { output: `Error: oldString not found in ${filePath}`, isError: true }
      }

      if (!replaceAll) {
        // Check for multiple matches
        const firstIndex = content.indexOf(oldString)
        const secondIndex = content.indexOf(oldString, firstIndex + 1)
        if (secondIndex !== -1) {
          return {
            output:
              `Error: Found multiple matches for oldString in ${filePath}. ` +
              `Provide more surrounding context to make it unique, or set replaceAll to true.`,
            isError: true,
          }
        }
      }

      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString)

      writeFileSync(resolved, newContent, "utf-8")

      // Emit file:modified event for undo support
      bus.emit("file:modified", {
        filePath: resolved,
        previousContent: content,
        timestamp: Date.now(),
        toolName: "Edit",
      })

      const matchCount = replaceAll
        ? content.split(oldString).length - 1
        : 1

      const diff = generateDiff(filePath, content, newContent)
      return {
        output: `Edited ${filePath} (${matchCount} replacement${matchCount > 1 ? "s" : ""})`,
        isError: false,
        metadata: {
          filePath: resolved,
          matchCount,
          diff: diff ? { unified: diff.unified, additions: diff.additions, deletions: diff.deletions } : undefined,
        },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error editing file: ${msg}`, isError: true }
    }
  },
}
