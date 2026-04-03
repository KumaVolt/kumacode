/**
 * Generic OpenAI-compatible provider.
 *
 * For services like Groq, Together AI, OpenRouter, LM Studio, Fireworks, Mistral, etc.
 * User provides a base URL and API key.
 */
import { OpenAICompatibleProvider } from "./openai-compat.js"
import type { ModelConfig } from "./base.js"

export interface CompatibleProviderConfig {
  /** Display name for this provider */
  name: string
  /** Base URL for the API (e.g., https://api.groq.com/openai/v1) */
  baseUrl: string
  /** API key */
  apiKey: string
  /** Optional known models (if not provided, will try to fetch via /models) */
  models?: ModelConfig[]
}

/** Well-known OpenAI-compatible providers with preset base URLs */
export const KNOWN_COMPATIBLE_PROVIDERS: Record<
  string,
  { name: string; baseUrl: string; docs: string }
> = {
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    docs: "https://console.groq.com/keys",
  },
  together: {
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    docs: "https://api.together.ai/settings/api-keys",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    docs: "https://openrouter.ai/keys",
  },
  fireworks: {
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    docs: "https://fireworks.ai/api-keys",
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    docs: "https://console.mistral.ai/api-keys/",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    docs: "https://platform.deepseek.com/api_keys",
  },
  lmstudio: {
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    docs: "https://lmstudio.ai",
  },
}

export function createCompatibleProvider(config: CompatibleProviderConfig) {
  // Generate a stable ID from the name
  const id = `compatible-${config.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`

  return new OpenAICompatibleProvider({
    id,
    name: config.name,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    models: config.models ?? [],
  })
}
