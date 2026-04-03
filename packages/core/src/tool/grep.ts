/**
 * Grep tool — search file contents with regex.
 * No permission required (read-only).
 */
import { z } from "zod"
import { spawn } from "node:child_process"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"

export const GrepInputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (defaults to working directory)"),
  include: z
    .string()
    .optional()
    .describe('File pattern to include (e.g., "*.ts", "*.{ts,tsx}")'),
})

export const grepTool: Tool = {
  name: "Grep",
  description:
    "Search file contents using regular expressions. " +
    "Returns file paths and line numbers with matches. " +
    "Filter by file type with the include parameter.",
  inputSchema: GrepInputSchema,
  requiresPermission: false,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = GrepInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { pattern, path: searchPath, include } = parsed.data
    const cwd = searchPath ?? context.cwd

    // Try ripgrep first, fall back to grep
    const useRipgrep = await commandExists("rg")

    return new Promise((resolve) => {
      const args: string[] = []

      if (useRipgrep) {
        args.push("--line-number", "--no-heading", "--color=never")
        args.push("--max-count=100")
        if (include) args.push("--glob", include)
        args.push("--glob", "!node_modules", "--glob", "!.git", "--glob", "!dist")
        args.push(pattern)
      } else {
        args.push("-rn", "--color=never")
        args.push("--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist")
        if (include) args.push("--include", include)
        args.push(pattern, ".")
      }

      const proc = spawn(useRipgrep ? "rg" : "grep", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString()
        if (stdout.length > 256_000) {
          proc.kill("SIGTERM")
        }
      })

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        if (code === 1 && !stdout && !stderr) {
          // grep returns 1 when no matches found
          resolve({ output: "No matches found.", isError: false })
          return
        }

        if (stderr && code !== 0 && code !== 1) {
          resolve({ output: `Error: ${stderr}`, isError: true })
          return
        }

        const lines = stdout.trim().split("\n").filter(Boolean)
        resolve({
          output: lines.length > 0 ? lines.join("\n") : "No matches found.",
          isError: false,
          metadata: { matchCount: lines.length },
        })
      })

      proc.on("error", () => {
        // Neither rg nor grep available, fall back to basic search
        resolve({
          output: "Error: Neither ripgrep (rg) nor grep is available on this system.",
          isError: true,
        })
      })

      proc.stdin.end()
    })
  },
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd], { stdio: "pipe" })
    proc.on("close", (code) => resolve(code === 0))
    proc.on("error", () => resolve(false))
  })
}
