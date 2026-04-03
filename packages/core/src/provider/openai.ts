/**
 * OpenAI provider — direct OpenAI API access.
 */
import { OpenAICompatibleProvider } from "./openai-compat.js"
import type { ModelConfig } from "./base.js"

const OPENAI_MODELS: ModelConfig[] = [
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1047576,
    maxOutput: 32768,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 2.0,
    outputPricePer1M: 8.0,
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    contextWindow: 1047576,
    maxOutput: 32768,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0.4,
    outputPricePer1M: 1.6,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    contextWindow: 128000,
    maxOutput: 16384,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
  },
  {
    id: "o3",
    name: "o3",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 10.0,
    outputPricePer1M: 40.0,
  },
  {
    id: "o3-mini",
    name: "o3 Mini",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsToolUse: true,
    supportsStreaming: true,
    inputPricePer1M: 1.1,
    outputPricePer1M: 4.4,
  },
  {
    id: "o1",
    name: "o1",
    contextWindow: 200000,
    maxOutput: 100000,
    supportsToolUse: true,
    supportsStreaming: true,
    supportsVision: true,
    inputPricePer1M: 15.0,
    outputPricePer1M: 60.0,
  },
]

export function createOpenAIProvider(apiKey: string) {
  return new OpenAICompatibleProvider({
    id: "openai",
    name: "OpenAI",
    apiKey,
    models: OPENAI_MODELS,
  })
}
