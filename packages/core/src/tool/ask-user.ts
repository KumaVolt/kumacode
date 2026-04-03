/**
 * AskUser tool — ask the user a question.
 * No permission required.
 */
import { z } from "zod"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"

export const AskUserInputSchema = z.object({
  question: z.string().describe("The question to ask the user"),
})

export const askUserTool: Tool = {
  name: "AskUser",
  description:
    "Ask the user a question to gather information, clarify requirements, " +
    "or get decisions on implementation choices.",
  inputSchema: AskUserInputSchema,
  requiresPermission: false,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = AskUserInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    if (!context.askUser) {
      return {
        output: "Cannot ask user — no interactive input available (non-interactive mode).",
        isError: true,
      }
    }

    try {
      const answer = await context.askUser(parsed.data.question)
      return { output: answer, isError: false }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error asking user: ${msg}`, isError: true }
    }
  },
}
