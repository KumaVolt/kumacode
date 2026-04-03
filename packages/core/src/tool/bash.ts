/**
 * Bash tool — execute shell commands.
 * Requires permission (can modify system state).
 */
import { z } from "zod"
import { spawn } from "node:child_process"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"

export const BashInputSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default 120000 / 2 minutes)"),
})

const DEFAULT_TIMEOUT = 120_000
const MAX_OUTPUT_SIZE = 512_000 // 512KB

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Execute a shell command in the working directory. " +
    "Returns stdout and stderr. Use this for git, npm, build tools, etc. " +
    "Commands run in bash. Long-running commands will be killed after the timeout.",
  inputSchema: BashInputSchema,
  requiresPermission: true,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = BashInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { command, timeout = DEFAULT_TIMEOUT } = parsed.data

    return new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      let killed = false

      const proc = spawn("bash", ["-c", command], {
        cwd: context.cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      })

      // Handle abort signal
      const abortHandler = () => {
        killed = true
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000)
      }
      context.abortSignal?.addEventListener("abort", abortHandler)

      // Timeout
      const timer = setTimeout(() => {
        killed = true
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 5000)
      }, timeout)

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString()
        // Truncate if too large
        if (stdout.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.slice(0, MAX_OUTPUT_SIZE) + "\n\n[Output truncated — exceeded 512KB]"
          proc.kill("SIGTERM")
        }
      })

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString()
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(0, MAX_OUTPUT_SIZE) + "\n\n[Stderr truncated — exceeded 512KB]"
        }
      })

      proc.on("close", (code) => {
        clearTimeout(timer)
        context.abortSignal?.removeEventListener("abort", abortHandler)

        let output = ""
        if (stdout) output += stdout
        if (stderr) output += (output ? "\n" : "") + stderr

        if (killed) {
          output += "\n[Command was terminated]"
        }

        if (!output) {
          output = code === 0 ? "(no output)" : `(exit code ${code})`
        }

        resolve({
          output: output.trim(),
          isError: code !== 0,
          metadata: { exitCode: code, killed },
        })
      })

      proc.on("error", (error) => {
        clearTimeout(timer)
        context.abortSignal?.removeEventListener("abort", abortHandler)
        resolve({
          output: `Error executing command: ${error.message}`,
          isError: true,
        })
      })

      // Close stdin
      proc.stdin.end()
    })
  },
}
