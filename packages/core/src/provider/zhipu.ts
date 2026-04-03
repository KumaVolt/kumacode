/**
 * Zhipu AI (z.ai) provider — GLM models via OpenAI-compatible API.
 *
 * Uses the coding-specific base URL for coding agent workloads.
 * Supports the "Coding Plan" subscription for optimized coding model access.
 *
 * API docs: https://bigmodel.cn/dev/api/normal-model/glm-4
 * API keys: https://bigmodel.cn/usercenter/proj-mgmt/apikeys
 */
import { OpenAICompatibleProvider } from "./openai-compat.js"
import type { ModelConfig } from "./base.js"

/**
 * Coding-specific base URL — recommended for coding agents (Cline, Claude Code, kumacode, etc.)
 * General API base URL: https://open.bigmodel.cn/api/paas/v4/
 */
const ZHIPU_CODING_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4"

const ZHIPU_MODELS: ModelConfig[] = [
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 5.0,
    outputPricePer1M: 5.0,
  },
  {
    id: "glm-5",
    name: "GLM-5",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 10.0,
    outputPricePer1M: 10.0,
  },
  {
    id: "glm-5-turbo",
    name: "GLM-5 Turbo",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 2.0,
    outputPricePer1M: 2.0,
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7 Flash (Free)",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 5.0,
    outputPricePer1M: 5.0,
  },
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 5.0,
    outputPricePer1M: 5.0,
  },
]

export function createZhipuProvider(apiKey: string) {
  return new OpenAICompatibleProvider({
    id: "zhipu",
    name: "Zhipu AI",
    apiKey,
    baseUrl: ZHIPU_CODING_BASE_URL,
    models: ZHIPU_MODELS,
  })
}
