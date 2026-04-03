/**
 * OpenAI ChatGPT Plus/Pro Subscription provider.
 *
 * Authenticates via OAuth (browser PKCE flow or headless device code flow)
 * against auth.openai.com, then calls the ChatGPT backend Responses API
 * at https://chatgpt.com/backend-api/codex/responses.
 *
 * This is NOT the same as the public OpenAI API (api.openai.com).
 * It uses the Responses API format, not Chat Completions.
 *
 * Based on publicly observable behavior of OpenCode's codex plugin.
 */
import OpenAI from "openai"
import type {
  Provider,
  ProviderConfig,
  ModelConfig,
  ChatParams,
  StreamEvent,
  Message,
  ContentBlock,
  ToolDefinition,
} from "./base.js"
import { zodToJsonSchema } from "./schema-convert.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createServer, type Server } from "node:http"
import { randomBytes, createHash } from "node:crypto"

// ─── Constants ───────────────────────────────────────────────────────────────

const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const CHATGPT_AUTH_BASE = "https://auth.openai.com"
const CHATGPT_AUTHORIZE_URL = `${CHATGPT_AUTH_BASE}/oauth/authorize`
const CHATGPT_TOKEN_URL = `${CHATGPT_AUTH_BASE}/oauth/token`
const CHATGPT_DEVICE_CODE_URL = `${CHATGPT_AUTH_BASE}/api/accounts/deviceauth/usercode`
const CHATGPT_DEVICE_TOKEN_URL = `${CHATGPT_AUTH_BASE}/api/accounts/deviceauth/token`
const CHATGPT_DEVICE_CALLBACK = `${CHATGPT_AUTH_BASE}/deviceauth/callback`
const CHATGPT_DEVICE_VERIFY_URL = `${CHATGPT_AUTH_BASE}/codex/device`

const CHATGPT_API_BASE = "https://chatgpt.com/backend-api/codex"
const CHATGPT_RESPONSES_URL = `${CHATGPT_API_BASE}/responses`

const LOCAL_CALLBACK_PORT = 1455
const LOCAL_REDIRECT_URI = `http://localhost:${LOCAL_CALLBACK_PORT}/auth/callback`

const OAUTH_SCOPES = "openid profile email offline_access"

const ORIGINATOR = "kumacode"
const USER_AGENT = "kumacode/0.1.0"

// Dummy API key for the OpenAI SDK — we override auth headers manually
const DUMMY_API_KEY = "kumacode-oauth-dummy-key"

// ─── Model list ──────────────────────────────────────────────────────────────
// These are subscription-included models (zero cost beyond subscription).

const CHATGPT_MODELS: ModelConfig[] = [
  {
    id: "gpt-5.4",
    name: "GPT-5.4 (ChatGPT)",
    contextWindow: 1047576,
    maxOutput: 32768,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (ChatGPT)",
    contextWindow: 1047576,
    maxOutput: 32768,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (ChatGPT)",
    contextWindow: 200000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex (ChatGPT)",
    contextWindow: 200000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex (ChatGPT)",
    contextWindow: 200000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini (ChatGPT)",
    contextWindow: 200000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
]

// ─── Auth token storage ──────────────────────────────────────────────────────

interface ChatGPTAuthData {
  type: "oauth"
  accessToken: string
  refreshToken: string
  expiresAt: number // ms since epoch
  accountId: string
}

function getAuthPath(): string {
  return join(homedir(), ".kumacode", "chatgpt-auth.json")
}

function loadChatGPTAuth(): ChatGPTAuthData | null {
  const path = getAuthPath()
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function saveChatGPTAuth(auth: ChatGPTAuthData): void {
  const dir = join(homedir(), ".kumacode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getAuthPath(), JSON.stringify(auth, null, 2))
}

// ─── JWT Utilities ───────────────────────────────────────────────────────────

/**
 * Decode a JWT payload without verifying the signature.
 * We only need to extract the accountId claim.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".")
  if (parts.length !== 3) return {}
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8")
    return JSON.parse(payload)
  } catch {
    return {}
  }
}

/**
 * Extract the ChatGPT account ID from the JWT access token.
 * The claim can be at `chatgpt_account_id` or `https://api.openai.com/auth.chatgpt_account_id`.
 */
function extractAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken)
  const accountId =
    (payload.chatgpt_account_id as string) ??
    (payload["https://api.openai.com/auth.chatgpt_account_id"] as string) ??
    ""
  return accountId
}

// ─── PKCE Utilities ──────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function generateState(): string {
  return randomBytes(16).toString("hex")
}

// ─── OAuth Token Refresh ─────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const response = await fetch(CHATGPT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

// ─── Browser OAuth Flow (Authorization Code + PKCE) ──────────────────────────

/**
 * Run the browser-based OAuth flow.
 * Opens the user's browser to auth.openai.com, starts a local HTTP server
 * on port 1455 to receive the callback, exchanges the code for tokens.
 */
export async function runChatGPTBrowserAuthFlow(): Promise<ChatGPTAuthData> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()

  const authUrl = new URL(CHATGPT_AUTHORIZE_URL)
  authUrl.searchParams.set("client_id", CHATGPT_OAUTH_CLIENT_ID)
  authUrl.searchParams.set("redirect_uri", LOCAL_REDIRECT_URI)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", OAUTH_SCOPES)
  authUrl.searchParams.set("state", state)
  authUrl.searchParams.set("code_challenge", codeChallenge)
  authUrl.searchParams.set("code_challenge_method", "S256")
  authUrl.searchParams.set("id_token_add_organizations", "true")
  authUrl.searchParams.set("codex_cli_simplified_flow", "true")
  authUrl.searchParams.set("originator", ORIGINATOR)

  // Start local server to catch the callback
  const authCode = await new Promise<string>((resolve, reject) => {
    let server: Server

    const timeout = setTimeout(() => {
      server?.close()
      reject(new Error("OAuth callback timed out after 5 minutes"))
    }, 5 * 60 * 1000)

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${LOCAL_CALLBACK_PORT}`)

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code")
        const returnedState = url.searchParams.get("state")
        const error = url.searchParams.get("error")

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end("<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>")
          clearTimeout(timeout)
          server.close()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (returnedState !== state) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end("<html><body><h2>State mismatch</h2><p>Authentication failed. Please try again.</p></body></html>")
          clearTimeout(timeout)
          server.close()
          reject(new Error("OAuth state mismatch"))
          return
        }

        if (!code) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end("<html><body><h2>No code received</h2></body></html>")
          clearTimeout(timeout)
          server.close()
          reject(new Error("No authorization code received"))
          return
        }

        res.writeHead(200, { "Content-Type": "text/html" })
        res.end("<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to your terminal.</p></body></html>")
        clearTimeout(timeout)
        server.close()
        resolve(code)
      } else {
        res.writeHead(404)
        res.end("Not found")
      }
    })

    server.listen(LOCAL_CALLBACK_PORT, () => {
      // Open the browser
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open"

      import("node:child_process").then(({ exec }) => {
        exec(`${openCmd} "${authUrl.toString()}"`)
      })
    })

    server.on("error", (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to start local auth server on port ${LOCAL_CALLBACK_PORT}: ${err.message}`))
    })
  })

  // Exchange the authorization code for tokens
  const tokenResponse = await fetch(CHATGPT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      code: authCode,
      redirect_uri: LOCAL_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text()
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${text}`)
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
    id_token?: string
  }

  const accountId = extractAccountId(tokenData.access_token)

  const auth: ChatGPTAuthData = {
    type: "oauth",
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    accountId,
  }

  saveChatGPTAuth(auth)
  return auth
}

// ─── Headless Device Code Flow ───────────────────────────────────────────────

/**
 * Run the headless device code flow for SSH/headless environments.
 * User visits auth.openai.com/codex/device and enters a code.
 */
export async function runChatGPTDeviceCodeFlow(): Promise<{
  userCode: string
  verificationUrl: string
  pollForToken: () => Promise<ChatGPTAuthData>
}> {
  // Step 1: Request a device code
  const codeResponse = await fetch(CHATGPT_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CHATGPT_OAUTH_CLIENT_ID,
    }),
  })

  if (!codeResponse.ok) {
    const text = await codeResponse.text()
    throw new Error(`Device code request failed: ${codeResponse.status} ${text}`)
  }

  const codeData = (await codeResponse.json()) as {
    device_auth_id: string
    user_code: string
    interval?: number
    expires_in?: number
  }

  const pollForToken = async (): Promise<ChatGPTAuthData> => {
    const interval = (codeData.interval || 5) * 1000
    const expiresAt = Date.now() + (codeData.expires_in || 900) * 1000

    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, interval))

      // Step 2: Poll for authorization
      const pollResponse = await fetch(CHATGPT_DEVICE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_auth_id: codeData.device_auth_id,
          user_code: codeData.user_code,
        }),
      })

      if (!pollResponse.ok) {
        // Keep polling on certain errors
        const pollText = await pollResponse.text()
        if (pollResponse.status === 400 || pollResponse.status === 428) {
          // authorization_pending — keep polling
          continue
        }
        throw new Error(`Device code poll failed: ${pollResponse.status} ${pollText}`)
      }

      const pollData = (await pollResponse.json()) as {
        authorization_code?: string
        code_verifier?: string
        error?: string
      }

      if (pollData.error === "authorization_pending") continue
      if (pollData.error === "slow_down") {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }
      if (pollData.error) {
        throw new Error(`Device auth failed: ${pollData.error}`)
      }

      if (pollData.authorization_code && pollData.code_verifier) {
        // Step 3: Exchange the authorization code for tokens
        const tokenResponse = await fetch(CHATGPT_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CHATGPT_OAUTH_CLIENT_ID,
            code: pollData.authorization_code,
            redirect_uri: CHATGPT_DEVICE_CALLBACK,
            code_verifier: pollData.code_verifier,
          }),
        })

        if (!tokenResponse.ok) {
          const text = await tokenResponse.text()
          throw new Error(`Token exchange failed: ${tokenResponse.status} ${text}`)
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string
          refresh_token: string
          expires_in: number
          token_type: string
        }

        const accountId = extractAccountId(tokenData.access_token)

        const auth: ChatGPTAuthData = {
          type: "oauth",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Date.now() + tokenData.expires_in * 1000,
          accountId,
        }

        saveChatGPTAuth(auth)
        return auth
      }
    }

    throw new Error("Device code flow expired. Please try again.")
  }

  return {
    userCode: codeData.user_code,
    verificationUrl: CHATGPT_DEVICE_VERIFY_URL,
    pollForToken,
  }
}

// ─── ChatGPT Provider ────────────────────────────────────────────────────────

/**
 * Provider for ChatGPT Plus/Pro subscription.
 * Uses the Responses API format (not Chat Completions).
 * Manages OAuth tokens with automatic refresh.
 */
export class ChatGPTProvider implements Provider {
  readonly config: ProviderConfig
  private auth: ChatGPTAuthData
  private sessionId: string

  constructor(auth: ChatGPTAuthData) {
    this.auth = auth
    this.sessionId = randomBytes(16).toString("hex")
    this.config = {
      id: "chatgpt",
      name: "ChatGPT (Subscription)",
      models: CHATGPT_MODELS,
    }
  }

  /**
   * Ensure we have a valid access token, refreshing if needed.
   */
  private async ensureValidToken(): Promise<string> {
    // Refresh if token expires within 60 seconds
    if (this.auth.expiresAt < Date.now() + 60_000) {
      try {
        const refreshed = await refreshAccessToken(this.auth.refreshToken)
        this.auth.accessToken = refreshed.accessToken
        this.auth.refreshToken = refreshed.refreshToken
        this.auth.expiresAt = Date.now() + refreshed.expiresIn * 1000
        this.auth.accountId = extractAccountId(refreshed.accessToken) || this.auth.accountId
        saveChatGPTAuth(this.auth)
      } catch (err) {
        throw new Error(
          `Failed to refresh ChatGPT OAuth token: ${err instanceof Error ? err.message : String(err)}. ` +
          `Run \`kumacode connect\` to re-authenticate.`
        )
      }
    }
    return this.auth.accessToken
  }

  /**
   * Stream a chat response using the Responses API.
   *
   * The Responses API has a fundamentally different format from Chat Completions:
   * - Input is an array of `ResponseInputItem` (messages, function calls, function call outputs)
   * - Tools are `FunctionTool` objects
   * - Streaming events are `ResponseStreamEvent` types
   *
   * We translate our internal Message[] format to/from the Responses API format.
   */
  async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
    const accessToken = await this.ensureValidToken()

    const input = this.convertMessagesToInput(params)
    const tools = params.tools ? this.convertTools(params.tools) : undefined

    try {
      // Use raw fetch for the Responses API since we need full control
      // over the endpoint URL and headers
      const body: Record<string, unknown> = {
        model: params.model,
        input,
        stream: true,
      }

      if (params.systemPrompt) {
        body.instructions = params.systemPrompt
      }

      if (params.maxTokens) {
        body.max_output_tokens = params.maxTokens
      }

      if (tools && tools.length > 0) {
        body.tools = tools
      }

      if (params.temperature !== undefined) {
        body.temperature = params.temperature
      }

      const response = await fetch(CHATGPT_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": this.auth.accountId,
          "User-Agent": USER_AGENT,
          "originator": ORIGINATOR,
          "session_id": this.sessionId,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`ChatGPT API error: ${response.status} ${text}`)
      }

      if (!response.body) {
        throw new Error("No response body received from ChatGPT API")
      }

      // Parse SSE stream
      yield* this.parseSSEStream(response.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: "error", error: message }
    }
  }

  /**
   * Parse an SSE stream from the Responses API and yield our StreamEvents.
   */
  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let hasActiveToolCall = false
    // Track current tool call info for mapping item_id → call_id/name
    const toolCallMap = new Map<string, { callId: string; name: string }>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE lines
        const lines = buffer.split("\n")
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
            if (!data || data === "[DONE]") continue

            try {
              const event = JSON.parse(data) as Record<string, unknown>
              yield* this.handleStreamEvent(event, hasActiveToolCall, toolCallMap)

              // Track tool call state
              const type = event.type as string
              if (type === "response.output_item.added") {
                const item = event.item as Record<string, unknown> | undefined
                if (item?.type === "function_call") {
                  hasActiveToolCall = true
                }
              }
              if (type === "response.function_call_arguments.done") {
                hasActiveToolCall = false
              }
              if (type === "response.completed" || type === "response.failed") {
                if (hasActiveToolCall) {
                  hasActiveToolCall = false
                }
              }
            } catch {
              // Ignore malformed JSON in stream
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const remaining = buffer.trim()
        if (remaining.startsWith("data: ")) {
          const data = remaining.slice(6).trim()
          if (data && data !== "[DONE]") {
            try {
              const event = JSON.parse(data) as Record<string, unknown>
              yield* this.handleStreamEvent(event, hasActiveToolCall, toolCallMap)
            } catch {
              // Ignore
            }
          }
        }
      }

      yield { type: "done" }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Handle a single Responses API stream event and yield our StreamEvents.
   */
  private *handleStreamEvent(
    event: Record<string, unknown>,
    _hasActiveToolCall: boolean,
    toolCallMap: Map<string, { callId: string; name: string }>,
  ): Generator<StreamEvent> {
    const type = event.type as string

    switch (type) {
      case "response.output_text.delta": {
        const delta = event.delta as string | undefined
        if (delta) {
          yield { type: "text_delta", text: delta }
        }
        break
      }

      case "response.output_item.added": {
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === "function_call") {
          const callId = (item.call_id as string) ?? ""
          const name = (item.name as string) ?? ""
          const itemId = (item.id as string) ?? ""

          // Store mapping for later delta events
          if (itemId) {
            toolCallMap.set(itemId, { callId, name })
          }

          yield {
            type: "tool_call_start",
            toolCall: {
              id: callId,
              name,
            },
          }
        }
        break
      }

      case "response.function_call_arguments.delta": {
        const delta = event.delta as string | undefined
        if (delta) {
          yield { type: "tool_call_delta", text: delta }
        }
        break
      }

      case "response.function_call_arguments.done": {
        yield { type: "tool_call_end" }
        break
      }

      case "response.error": {
        const errorObj = event.error as Record<string, unknown> | undefined
        const message = (errorObj?.message as string) ?? "Unknown ChatGPT API error"
        yield { type: "error", error: message }
        break
      }

      // Other event types (response.created, response.in_progress,
      // response.output_item.done, response.completed, etc.) are ignored
      // as they don't map to our StreamEvent types.
    }
  }

  /**
   * Convert our Message[] format to the Responses API input format.
   *
   * The Responses API uses:
   * - `{ role: "user"/"assistant"/"system"/"developer", content: string }` for messages
   * - `{ type: "function_call", call_id, name, arguments }` for assistant tool calls
   * - `{ type: "function_call_output", call_id, output }` for tool results
   */
  private convertMessagesToInput(
    params: ChatParams,
  ): Array<Record<string, unknown>> {
    const input: Array<Record<string, unknown>> = []

    for (const msg of params.messages) {
      if (msg.role === "system") {
        // System messages go as developer role in Responses API
        input.push({
          role: "developer",
          content: typeof msg.content === "string"
            ? msg.content
            : this.flattenContent(msg.content as ContentBlock[]),
        })
      } else if (msg.role === "user") {
        // Check if this is a tool result message
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const result of msg.toolResults) {
            input.push({
              type: "function_call_output",
              call_id: result.toolCallId,
              output: result.output,
            })
          }
        } else if (Array.isArray(msg.content)) {
          const blocks = msg.content as ContentBlock[]
          const toolResults = blocks.filter(
            (b) => b.type === "tool_result",
          )
          if (toolResults.length > 0) {
            for (const block of toolResults) {
              input.push({
                type: "function_call_output",
                call_id: block.toolCallId ?? "",
                output: block.output ?? "",
              })
            }
          } else {
            // Check for image blocks — Responses API uses input_image content parts
            const hasImages = blocks.some((b) => b.type === "image")
            if (hasImages) {
              const parts: Array<Record<string, unknown>> = []
              for (const block of blocks) {
                if (block.type === "text" && block.text) {
                  parts.push({ type: "input_text", text: block.text })
                } else if (block.type === "image" && block.imageSource) {
                  const url = block.imageSource.type === "base64"
                    ? `data:${block.imageSource.mediaType};base64,${block.imageSource.data}`
                    : block.imageSource.url ?? ""
                  parts.push({
                    type: "input_image",
                    image_url: url,
                  })
                }
              }
              input.push({
                role: "user",
                content: parts,
              })
            } else {
              input.push({
                role: "user",
                content: this.flattenContent(blocks),
              })
            }
          }
        } else {
          input.push({
            role: "user",
            content: msg.content as string,
          })
        }
      } else if (msg.role === "assistant") {
        // First, add text content as a message if present
        const textContent = typeof msg.content === "string"
          ? msg.content
          : this.flattenContent(msg.content as ContentBlock[])

        if (textContent) {
          input.push({
            role: "assistant",
            content: textContent,
          })
        }

        // Then add any tool calls as separate function_call items
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            input.push({
              type: "function_call",
              call_id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            })
          }
        }
      }
    }

    return input
  }

  /**
   * Convert our ToolDefinition format to the Responses API FunctionTool format.
   */
  private convertTools(
    tools: ToolDefinition[],
  ): Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: boolean }> {
    return tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema),
      strict: false,
    }))
  }

  private flattenContent(blocks: ContentBlock[]): string {
    return blocks
      .map((b) => b.text ?? b.output ?? "")
      .filter(Boolean)
      .join("\n")
  }

  async listModels(): Promise<ModelConfig[]> {
    return this.config.models
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/**
 * Create a ChatGPT provider from stored OAuth tokens.
 * Throws if not authenticated.
 */
export async function createChatGPTProvider(): Promise<ChatGPTProvider> {
  const auth = loadChatGPTAuth()
  if (!auth) {
    throw new Error("No ChatGPT OAuth tokens found. Run `kumacode connect` to authenticate.")
  }
  return new ChatGPTProvider(auth)
}

/**
 * Create a ChatGPT provider from explicit auth data (e.g., right after OAuth flow).
 */
export function createChatGPTProviderFromAuth(auth: ChatGPTAuthData): ChatGPTProvider {
  return new ChatGPTProvider(auth)
}

/**
 * Check if ChatGPT auth is already configured.
 */
export function isChatGPTConfigured(): boolean {
  const auth = loadChatGPTAuth()
  return auth != null
}
