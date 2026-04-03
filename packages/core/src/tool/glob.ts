/**
 * Glob tool — find files by pattern.
 * No permission required (read-only).
 */
import { z } from "zod"
import fg from "fast-glob"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"

export const GlobInputSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")'),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (defaults to working directory)"),
})

export const globTool: Tool = {
  name: "Glob",
  description:
    "Find files matching a glob pattern. " +
    "Returns matching file paths sorted by modification time. " +
    'Use patterns like "**/*.ts" or "src/**/*.tsx".',
  inputSchema: GlobInputSchema,
  requiresPermission: false,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = GlobInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { pattern, path: searchPath } = parsed.data
    const cwd = searchPath ?? context.cwd

    try {
      const files = await fg(pattern, {
        cwd,
        dot: false,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
        stats: true,
        onlyFiles: true,
      })

      if (files.length === 0) {
        return { output: "No files found matching the pattern.", isError: false }
      }

      // Sort by modification time (most recent first)
      files.sort((a, b) => {
        const aTime = a.stats?.mtimeMs ?? 0
        const bTime = b.stats?.mtimeMs ?? 0
        return bTime - aTime
      })

      const paths = files.map((f) => f.path)
      const output = paths.join("\n")

      return {
        output: paths.length > 100
          ? paths.slice(0, 100).join("\n") + `\n\n(${paths.length} total files, showing first 100)`
          : output,
        isError: false,
        metadata: { fileCount: paths.length },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error searching files: ${msg}`, isError: true }
    }
  },
}
