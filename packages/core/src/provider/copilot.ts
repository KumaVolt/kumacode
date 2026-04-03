/**
 * GitHub Copilot provider.
 *
 * Uses the GitHub Copilot chat completions API, which is OpenAI-compatible.
 * Auth is via a GitHub OAuth token obtained through the device code flow.
 *
 * Copilot exposes access to multiple models (Claude, GPT, Gemini) depending
 * on the user's subscription.
 */
import { OpenAICompatibleProvider } from "./openai-compat.js"
import type { ModelConfig } from "./base.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const COPILOT_BASE_URL = "https://api.githubcopilot.com"
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
// Copilot's known client ID (used by VS Code and other tools)
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"

const COPILOT_MODELS: ModelConfig[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o (Copilot)",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1 (Copilot)",
    contextWindow: 1047576,
    maxOutput: 32768,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4 (Copilot)",
    contextWindow: 200000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet (Copilot)",
    contextWindow: 200000,
    maxOutput: 8192,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro (Copilot)",
    contextWindow: 1048576,
    maxOutput: 65536,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "o3-mini",
    name: "o3 Mini (Copilot)",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsToolUse: true,
    supportsStreaming: true,
  },
]

interface CopilotToken {
  token: string
  expiresAt: number
}

interface StoredAuth {
  githubToken: string
  copilotToken?: CopilotToken
}

function getAuthPath(): string {
  return join(homedir(), ".kumacode", "copilot-auth.json")
}

function loadAuth(): StoredAuth | null {
  const path = getAuthPath()
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function saveAuth(auth: StoredAuth): void {
  const dir = join(homedir(), ".kumacode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getAuthPath(), JSON.stringify(auth, null, 2))
}

/**
 * Exchange a GitHub OAuth token for a Copilot API token.
 * Copilot tokens expire, so we cache them and refresh as needed.
 */
async function getCopilotToken(githubToken: string): Promise<string> {
  const auth = loadAuth()

  // Check if we have a cached valid token
  if (auth?.copilotToken && auth.copilotToken.expiresAt > Date.now() + 60000) {
    return auth.copilotToken.token
  }

  // Get a fresh Copilot token
  const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "kumacode/0.1.0",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to get Copilot token: ${response.status} ${text}. Make sure you have an active GitHub Copilot subscription.`,
    )
  }

  const data = (await response.json()) as { token: string; expires_at: number }
  const copilotToken: CopilotToken = {
    token: data.token,
    expiresAt: data.expires_at * 1000,
  }

  // Cache it
  saveAuth({ githubToken, copilotToken })

  return copilotToken.token
}

/**
 * Run the GitHub device code OAuth flow.
 * Returns a GitHub access token.
 */
export async function runDeviceCodeFlow(): Promise<{
  githubToken: string
  userCode: string
  verificationUri: string
  pollForToken: () => Promise<string>
}> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "copilot",
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to start device code flow: ${response.status}`)
  }

  const data = (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
    expires_in: number
  }

  const pollForToken = async (): Promise<string> => {
    const interval = (data.interval || 5) * 1000
    const expiresAt = Date.now() + data.expires_in * 1000

    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, interval))

      const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: COPILOT_CLIENT_ID,
          device_code: data.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string
        error?: string
      }

      if (tokenData.access_token) {
        saveAuth({ githubToken: tokenData.access_token })
        return tokenData.access_token
      }

      if (tokenData.error === "authorization_pending") continue
      if (tokenData.error === "slow_down") {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }
      if (tokenData.error) {
        throw new Error(`Auth failed: ${tokenData.error}`)
      }
    }

    throw new Error("Device code flow expired. Please try again.")
  }

  return {
    githubToken: "",
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    pollForToken,
  }
}

/**
 * Create a GitHub Copilot provider from a stored GitHub token.
 */
export async function createCopilotProvider(githubToken?: string): Promise<OpenAICompatibleProvider> {
  const token = githubToken ?? loadAuth()?.githubToken
  if (!token) {
    throw new Error("No GitHub token found. Run `kumacode connect` to set up GitHub Copilot.")
  }

  const copilotToken = await getCopilotToken(token)

  return new OpenAICompatibleProvider({
    id: "copilot",
    name: "GitHub Copilot",
    apiKey: copilotToken,
    baseUrl: COPILOT_BASE_URL,
    models: COPILOT_MODELS,
    defaultHeaders: {
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "kumacode/0.1.0",
    },
  })
}

/**
 * Check if GitHub Copilot auth is already configured.
 */
export function isCopilotConfigured(): boolean {
  const auth = loadAuth()
  return auth?.githubToken != null
}
