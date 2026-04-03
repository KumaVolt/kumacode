/**
 * WebFetch tool — fetch content from a URL.
 * Requires permission.
 */
import { z } from "zod"
import type { Tool, ToolContext, ToolInput, ToolOutput } from "./base.js"

export const WebFetchInputSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .optional()
    .describe('Format to return content in (default "text")'),
})

const MAX_RESPONSE_SIZE = 512_000 // 512KB

export const webFetchTool: Tool = {
  name: "WebFetch",
  description:
    "Fetch content from a URL and return it as text. " +
    "Useful for reading documentation, API responses, or web pages.",
  inputSchema: WebFetchInputSchema,
  requiresPermission: true,

  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const parsed = WebFetchInputSchema.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, isError: true }
    }

    const { url, format = "text" } = parsed.data

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "kumacode/0.1.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
      })

      if (!response.ok) {
        return {
          output: `HTTP ${response.status}: ${response.statusText}`,
          isError: true,
        }
      }

      let text = await response.text()

      if (text.length > MAX_RESPONSE_SIZE) {
        text = text.slice(0, MAX_RESPONSE_SIZE) + "\n\n[Content truncated — exceeded 512KB]"
      }

      // Basic HTML-to-text stripping for readability
      if (format === "text" && response.headers.get("content-type")?.includes("html")) {
        text = stripHtml(text)
      }

      return {
        output: text,
        isError: false,
        metadata: {
          url,
          contentType: response.headers.get("content-type"),
          size: text.length,
        },
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { output: `Error fetching URL: ${msg}`, isError: true }
    }
  },
}

/**
 * Basic HTML stripping — removes tags and decodes common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim()
}
