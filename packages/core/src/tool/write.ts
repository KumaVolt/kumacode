/**
 * Write tool — create or overwrite files.
 * Requires permission. Emits file:modified for undo support.
 */
import { z } from "zod"
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"
import { resolvePath, isWithinCwd } from "../util/path.js"
import { generateDiff } from "../util/diff.js"
import { bus } from "../bus/bus.js"

export const WriteInputSchema = z.object({
  filePath: z.string().describe("The absolute or relative path to the file to write"),
  content: z.string().describe("The content to write to the file"),
})

export const writeTool: Tool = {
  name: "Write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, " +
    "or overwrites it if it does. Creates parent directories as needed.",
  inputSchema: WriteInputSchema,
  requiresPermission: true,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = WriteInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { filePath, content } = parsed.data
    const resolved = resolvePath(context.cwd, filePath)

    if (!isWithinCwd(context.cwd, filePath)) {
      return { output: `Error: Path "${filePath}" is outside the working directory`, isError: true }
    }

    try {
      const dir = dirname(resolved)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const existed = existsSync(resolved)
      // Capture previous content for undo
      const previousContent = existed ? readFileSync(resolved, "utf-8") : null

      writeFileSync(resolved, content, "utf-8")

      // Emit file:modified event for undo support
      bus.emit("file:modified", {
        filePath: resolved,
        previousContent,
        timestamp: Date.now(),
        toolName: "Write",
      })

      const lines = content.split("\n").length
      const diff = generateDiff(filePath, previousContent, content)
      return {
        output: `${existed ? "Updated" : "Created"} ${filePath} (${lines} lines)`,
        isError: false,
        metadata: {
          filePath: resolved,
          lines,
          created: !existed,
          diff: diff ? { unified: diff.unified, additions: diff.additions, deletions: diff.deletions } : undefined,
        },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error writing file: ${msg}`, isError: true }
    }
  },
}
