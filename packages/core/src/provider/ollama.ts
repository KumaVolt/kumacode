/**
 * Ollama provider — local models via the Ollama API.
 *
 * Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1
 * so we just extend the OpenAI-compatible provider with different defaults.
 */
import { OpenAICompatibleProvider } from "./openai-compat.js"
import type { ModelConfig } from "./base.js"

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"

/**
 * Fetch available models from the Ollama API.
 */
async function fetchOllamaModels(baseUrl: string): Promise<ModelConfig[]> {
  try {
    // Ollama's native API endpoint for listing models
    const nativeUrl = baseUrl.replace("/v1", "")
    const response = await fetch(`${nativeUrl}/api/tags`)
    if (!response.ok) return []

    const data = (await response.json()) as {
      models: Array<{
        name: string
        size: number
        details?: { parameter_size?: string; family?: string }
      }>
    }

    return data.models.map((m) => ({
      id: m.name,
      name: m.name,
      contextWindow: 128000, // Approximation — Ollama doesn't always expose this
      maxOutput: 4096,
      supportsToolUse: true, // Most modern models support tool use
      supportsStreaming: true,
    }))
  } catch {
    return []
  }
}

export function createOllamaProvider(baseUrl?: string) {
  const url = baseUrl ?? DEFAULT_OLLAMA_BASE_URL

  return new OpenAICompatibleProvider({
    id: "ollama",
    name: "Ollama (Local)",
    apiKey: "ollama", // Ollama doesn't require an API key
    baseUrl: url,
    models: [], // Will be populated via listModels()
  })
}

/**
 * Create an Ollama provider and prefetch available models.
 */
export async function createOllamaProviderWithModels(
  baseUrl?: string,
): Promise<OpenAICompatibleProvider> {
  const url = baseUrl ?? DEFAULT_OLLAMA_BASE_URL
  const models = await fetchOllamaModels(url)

  return new OpenAICompatibleProvider({
    id: "ollama",
    name: "Ollama (Local)",
    apiKey: "ollama",
    baseUrl: url,
    models,
  })
}

/**
 * Check if Ollama is running locally.
 */
export async function isOllamaRunning(baseUrl?: string): Promise<boolean> {
  try {
    const url = (baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace("/v1", "")
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}
