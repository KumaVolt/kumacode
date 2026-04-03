/**
 * Read tool — read file contents.
 * No permission required (read-only).
 */
import { z } from "zod"
import { readFileSync, statSync } from "node:fs"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"
import { resolvePath, isWithinCwd } from "../util/path.js"

export const ReadInputSchema = z.object({
  filePath: z.string().describe("The absolute or relative path to the file to read"),
  offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
  limit: z.number().optional().describe("Maximum number of lines to read (default 2000)"),
})

export const readTool: Tool = {
  name: "Read",
  description:
    "Read a file from the filesystem. Returns the file content with line numbers. " +
    "Use offset and limit to read specific sections of large files.",
  inputSchema: ReadInputSchema,
  requiresPermission: false,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = ReadInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { filePath, offset = 1, limit = 2000 } = parsed.data
    const resolved = resolvePath(context.cwd, filePath)

    // Security: ensure path is within cwd or home
    if (!isWithinCwd(context.cwd, filePath) && !resolved.startsWith(process.env.HOME ?? "")) {
      return { output: `Error: Path "${filePath}" is outside the allowed directory`, isError: true }
    }

    try {
      const stat = statSync(resolved)

      if (stat.isDirectory()) {
        // List directory contents
        const { readdirSync } = await import("node:fs")
        const entries = readdirSync(resolved, { withFileTypes: true })
        const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        return {
          output: lines.join("\n"),
          isError: false,
          metadata: { type: "directory", entryCount: entries.length },
        }
      }

      // Check file size (warn if very large)
      if (stat.size > 10 * 1024 * 1024) {
        return {
          output: `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset and limit to read sections.`,
          isError: true,
        }
      }

      const content = readFileSync(resolved, "utf-8")
      const allLines = content.split("\n")
      const startLine = Math.max(1, offset)
      const endLine = Math.min(allLines.length, startLine + limit - 1)
      const selectedLines = allLines.slice(startLine - 1, endLine)

      // Format with line numbers
      const numbered = selectedLines.map(
        (line, i) => `${startLine + i}: ${line}`,
      )

      let output = numbered.join("\n")
      if (endLine < allLines.length) {
        output += `\n\n(File has ${allLines.length} total lines. Showing lines ${startLine}-${endLine})`
      }

      return {
        output,
        isError: false,
        metadata: {
          totalLines: allLines.length,
          startLine,
          endLine,
          filePath: resolved,
        },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error reading file: ${msg}`, isError: true }
    }
  },
}
