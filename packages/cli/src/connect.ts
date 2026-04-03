/**
 * Interactive `kumacode connect` wizard.
 *
 * Walks the user through configuring a model provider.
 * Uses basic readline for interactive prompts (not Ink — runs before TUI).
 */
import * as readline from "node:readline"
import {
  providerRegistry,
  saveUserSettings,
  isCopilotConfigured,
  runDeviceCodeFlow,
  createCopilotProvider,
  createOpenAIProvider,
  createGoogleProvider,
  createOllamaProvider,
  createOllamaProviderWithModels,
  createCompatibleProvider,
  createZhipuProvider,
  isChatGPTConfigured,
  runChatGPTBrowserAuthFlow,
  runChatGPTDeviceCodeFlow,
  createChatGPTProviderFromAuth,
  KNOWN_COMPATIBLE_PROVIDERS,
  type ProviderSettings,
} from "@kumacode/core"

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

function print(text: string) {
  console.log(text)
}

export async function runConnectWizard(): Promise<void> {
  const rl = createRl()

  print("")
  print("\x1b[1m\x1b[38;5;215m  KumaCode — Provider Setup\x1b[0m")
  print("")
  print("  Choose a provider to configure:")
  print("")
  print("  \x1b[1m1.\x1b[0m GitHub Copilot  \x1b[2m(Recommended — access to Claude, GPT, Gemini)\x1b[0m")
  print("  \x1b[1m2.\x1b[0m OpenAI")
  print("  \x1b[1m3.\x1b[0m Google Gemini")
  print("  \x1b[1m4.\x1b[0m Ollama          \x1b[2m(local models)\x1b[0m")
  print("  \x1b[1m5.\x1b[0m OpenAI-Compatible \x1b[2m(Groq, OpenRouter, Together, etc.)\x1b[0m")
  print("  \x1b[1m6.\x1b[0m Zhipu AI        \x1b[2m(GLM models — z.ai Coding Plan)\x1b[0m")
  print("  \x1b[1m7.\x1b[0m ChatGPT Plus/Pro \x1b[2m(use your ChatGPT subscription)\x1b[0m")
  print("")

  const choice = await ask(rl, "  Enter choice (1-7): ")

  try {
    switch (choice) {
      case "1":
        await setupCopilot(rl)
        break
      case "2":
        await setupOpenAI(rl)
        break
      case "3":
        await setupGoogle(rl)
        break
      case "4":
        await setupOllama(rl)
        break
      case "5":
        await setupCompatible(rl)
        break
      case "6":
        await setupZhipu(rl)
        break
      case "7":
        await setupChatGPT(rl)
        break
      default:
        print("\n  Invalid choice. Please run `kumacode connect` again.")
        rl.close()
        return
    }
  } catch (err) {
    print(`\n  \x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`)
  }

  rl.close()
}

async function setupCopilot(rl: readline.Interface): Promise<void> {
  print("")

  if (isCopilotConfigured()) {
    const reauth = await ask(rl, "  GitHub Copilot is already configured. Re-authenticate? (y/N): ")
    if (reauth.toLowerCase() !== "y") {
      print("  Keeping existing configuration.")
      await activateCopilot(rl)
      return
    }
  }

  print("  Starting GitHub device code flow...")
  print("  \x1b[2m(This requires a GitHub account with an active Copilot subscription)\x1b[0m")
  print("")

  const flow = await runDeviceCodeFlow()

  print(`  \x1b[1mOpen this URL:\x1b[0m  ${flow.verificationUri}`)
  print(`  \x1b[1mEnter code:\x1b[0m     \x1b[33m${flow.userCode}\x1b[0m`)
  print("")
  print("  Waiting for authorization...")

  const githubToken = await flow.pollForToken()

  print("  \x1b[32m✓\x1b[0m GitHub authorized successfully!")
  print("")

  await activateCopilot(rl, githubToken)
}

async function activateCopilot(rl: readline.Interface, githubToken?: string): Promise<void> {
  print("  Connecting to Copilot API...")

  const provider = await createCopilotProvider(githubToken)
  providerRegistry.register(provider)

  // Ask which model to use
  print("")
  print("  Available models:")
  const models = provider.config.models
  models.forEach((m, i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
  })
  print("")

  const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
  const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
  const selectedModel = models[modelIdx]

  providerRegistry.setActive(provider.config.id, selectedModel.id)

  // Save settings
  const providerSetting: ProviderSettings = {
    id: "copilot",
    name: "GitHub Copilot",
    type: "copilot",
  }
  saveUserSettings({
    provider: "copilot",
    model: selectedModel.id,
    providers: [providerSetting],
  })

  print("")
  print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via GitHub Copilot`)
  print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
  print("")
}

async function setupOpenAI(rl: readline.Interface): Promise<void> {
  print("")
  print("  \x1b[2mGet your API key at: https://platform.openai.com/api-keys\x1b[0m")
  print("")

  const apiKey = await ask(rl, "  Enter your OpenAI API key: ")
  if (!apiKey) {
    print("  No key provided. Aborting.")
    return
  }

  const provider = createOpenAIProvider(apiKey)
  providerRegistry.register(provider)

  // Select model
  const models = provider.config.models
  print("")
  print("  Available models:")
  models.forEach((m, i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
  })
  print("")

  const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
  const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
  const selectedModel = models[modelIdx]

  providerRegistry.setActive(provider.config.id, selectedModel.id)

  saveUserSettings({
    provider: "openai",
    model: selectedModel.id,
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        type: "openai",
        apiKey,
      },
    ],
  })

  print("")
  print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via OpenAI`)
  print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
  print("")
}

async function setupGoogle(rl: readline.Interface): Promise<void> {
  print("")
  print("  \x1b[2mGet your API key at: https://aistudio.google.com/app/apikey\x1b[0m")
  print("")

  const apiKey = await ask(rl, "  Enter your Google Gemini API key: ")
  if (!apiKey) {
    print("  No key provided. Aborting.")
    return
  }

  const provider = createGoogleProvider(apiKey)
  providerRegistry.register(provider)

  const models = provider.config.models
  print("")
  print("  Available models:")
  models.forEach((m, i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
  })
  print("")

  const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
  const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
  const selectedModel = models[modelIdx]

  providerRegistry.setActive(provider.config.id, selectedModel.id)

  saveUserSettings({
    provider: "google",
    model: selectedModel.id,
    providers: [
      {
        id: "google",
        name: "Google Gemini",
        type: "google",
        apiKey,
      },
    ],
  })

  print("")
  print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via Google Gemini`)
  print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
  print("")
}

async function setupOllama(rl: readline.Interface): Promise<void> {
  print("")
  const baseUrl = await ask(rl, "  Ollama URL [http://localhost:11434/v1]: ")
  const url = baseUrl || undefined

  print("  Checking for Ollama...")

  try {
    const provider = await createOllamaProviderWithModels(url)
    providerRegistry.register(provider)

    const models = provider.config.models
    if (models.length === 0) {
      print("  \x1b[33m⚠\x1b[0m Ollama is running but has no models pulled.")
      print("  Run \x1b[1mollama pull llama3.2\x1b[0m to get started.")
      return
    }

    print(`  Found ${models.length} model(s):`)
    print("")
    models.forEach((m, i) => {
      print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
    })
    print("")

    const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
    const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
    const selectedModel = models[modelIdx]

    providerRegistry.setActive(provider.config.id, selectedModel.id)

    saveUserSettings({
      provider: "ollama",
      model: selectedModel.id,
      providers: [
        {
          id: "ollama",
          name: "Ollama",
          type: "ollama",
          baseUrl: url,
        },
      ],
    })

    print("")
    print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via Ollama`)
    print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
    print("")
  } catch (err) {
    print(`  \x1b[31m✗\x1b[0m Could not connect to Ollama at ${url || "http://localhost:11434"}`)
    print("  Make sure Ollama is running: \x1b[1mollama serve\x1b[0m")
  }
}

async function setupCompatible(rl: readline.Interface): Promise<void> {
  print("")
  print("  Known providers:")
  const presets = Object.entries(KNOWN_COMPATIBLE_PROVIDERS)
  presets.forEach(([key, p], i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${p.name}`)
  })
  print(`  \x1b[1m${presets.length + 1}.\x1b[0m Custom endpoint`)
  print("")

  const choice = await ask(rl, `  Choose provider (1-${presets.length + 1}): `)
  const choiceNum = parseInt(choice, 10)

  let name: string
  let baseUrl: string
  let docsUrl: string | null = null

  if (choiceNum >= 1 && choiceNum <= presets.length) {
    const [, preset] = presets[choiceNum - 1]
    name = preset.name
    baseUrl = preset.baseUrl
    docsUrl = preset.docs
  } else {
    // Custom
    name = await ask(rl, "  Provider name: ")
    if (!name) { print("  Aborting."); return }
    baseUrl = await ask(rl, "  API base URL: ")
    if (!baseUrl) { print("  Aborting."); return }
  }

  if (docsUrl) {
    print(`  \x1b[2mGet your API key at: ${docsUrl}\x1b[0m`)
  }
  print("")

  const apiKey = await ask(rl, `  Enter your ${name} API key: `)
  if (!apiKey) {
    print("  No key provided. Aborting.")
    return
  }

  const provider = createCompatibleProvider({ name, baseUrl, apiKey })
  providerRegistry.register(provider)

  // Try to fetch models from the API
  print("  Fetching available models...")
  try {
    const models = await provider.listModels()
    if (models.length > 0) {
      // Update provider's model list with fetched models
      // Show first 10
      const showModels = models.slice(0, 10)
      print("")
      print(`  Found ${models.length} model(s)${models.length > 10 ? " (showing first 10)" : ""}:`)
      showModels.forEach((m, i) => {
        print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
      })
      print("")

      const modelChoice = await ask(rl, `  Choose model (1-${showModels.length}) or type a model ID: `)
      const modelNum = parseInt(modelChoice, 10)
      let selectedModelId: string
      if (modelNum >= 1 && modelNum <= showModels.length) {
        selectedModelId = showModels[modelNum - 1].id
      } else {
        selectedModelId = modelChoice || showModels[0].id
      }

      providerRegistry.setActive(provider.config.id, selectedModelId)

      saveUserSettings({
        provider: provider.config.id,
        model: selectedModelId,
        providers: [
          {
            id: provider.config.id,
            name,
            type: "compatible",
            baseUrl,
            apiKey,
            model: selectedModelId,
          },
        ],
      })

      print("")
      print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModelId}\x1b[0m via ${name}`)
      print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
      print("")
    } else {
      print("  No models found via API. Enter a model ID manually.")
      const modelId = await ask(rl, "  Model ID: ")
      if (!modelId) { print("  Aborting."); return }

      // Can't setActive since model doesn't exist in registry — add a placeholder
      saveUserSettings({
        provider: provider.config.id,
        model: modelId,
        providers: [
          {
            id: provider.config.id,
            name,
            type: "compatible",
            baseUrl,
            apiKey,
            model: modelId,
          },
        ],
      })

      print("")
      print(`  \x1b[32m✓\x1b[0m Saved: \x1b[1m${modelId}\x1b[0m via ${name}`)
      print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
      print("")
    }
  } catch {
    print("  Could not fetch models from API. Enter a model ID manually.")
    const modelId = await ask(rl, "  Model ID: ")
    if (!modelId) { print("  Aborting."); return }

    saveUserSettings({
      provider: provider.config.id,
      model: modelId,
      providers: [
        {
          id: provider.config.id,
          name,
          type: "compatible",
          baseUrl,
          apiKey,
          model: modelId,
        },
      ],
    })

    print("")
    print(`  \x1b[32m✓\x1b[0m Saved: \x1b[1m${modelId}\x1b[0m via ${name}`)
    print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
    print("")
  }
}

async function setupZhipu(rl: readline.Interface): Promise<void> {
  print("")
  print("  \x1b[2mZhipu AI (z.ai) — GLM models optimized for coding agents\x1b[0m")
  print("  \x1b[2mGet your API key at: https://bigmodel.cn/usercenter/proj-mgmt/apikeys\x1b[0m")
  print("")

  const apiKey = await ask(rl, "  Enter your Zhipu AI API key: ")
  if (!apiKey) {
    print("  No key provided. Aborting.")
    return
  }

  const provider = createZhipuProvider(apiKey)
  providerRegistry.register(provider)

  // Select model
  const models = provider.config.models
  print("")
  print("  Available models:")
  models.forEach((m, i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
  })
  print("")

  const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
  const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
  const selectedModel = models[modelIdx]

  providerRegistry.setActive(provider.config.id, selectedModel.id)

  saveUserSettings({
    provider: "zhipu",
    model: selectedModel.id,
    providers: [
      {
        id: "zhipu",
        name: "Zhipu AI",
        type: "zhipu",
        apiKey,
      },
    ],
  })

  print("")
  print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via Zhipu AI`)
  print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
  print("")
}

async function setupChatGPT(rl: readline.Interface): Promise<void> {
  print("")
  print("  \x1b[2mChatGPT Plus/Pro — use your ChatGPT subscription for coding models\x1b[0m")
  print("  \x1b[2mRequires an active ChatGPT Plus or Pro subscription at chatgpt.com\x1b[0m")
  print("")

  if (isChatGPTConfigured()) {
    const reauth = await ask(rl, "  ChatGPT is already configured. Re-authenticate? (y/N): ")
    if (reauth.toLowerCase() !== "y") {
      print("  Keeping existing configuration.")
      await activateChatGPT(rl)
      return
    }
  }

  print("  Choose authentication method:")
  print("")
  print("  \x1b[1m1.\x1b[0m Browser login  \x1b[2m(opens browser — recommended)\x1b[0m")
  print("  \x1b[1m2.\x1b[0m Device code    \x1b[2m(for SSH/headless environments)\x1b[0m")
  print("")

  const authChoice = await ask(rl, "  Enter choice (1-2) [1]: ")

  try {
    if (authChoice === "2") {
      // Device code flow
      print("")
      print("  Starting device code flow...")

      const flow = await runChatGPTDeviceCodeFlow()

      print("")
      print(`  \x1b[1mOpen this URL:\x1b[0m  ${flow.verificationUrl}`)
      print(`  \x1b[1mEnter code:\x1b[0m     \x1b[33m${flow.userCode}\x1b[0m`)
      print("")
      print("  Waiting for authorization...")

      const auth = await flow.pollForToken()

      print("  \x1b[32m✓\x1b[0m Authenticated successfully!")
      print("")

      const provider = createChatGPTProviderFromAuth(auth)
      providerRegistry.register(provider)
      await selectChatGPTModel(rl, provider)
    } else {
      // Browser OAuth flow (default)
      print("")
      print("  Opening browser for authentication...")
      print("  \x1b[2m(If your browser doesn't open, check the URL printed below)\x1b[0m")
      print("")

      const auth = await runChatGPTBrowserAuthFlow()

      print("  \x1b[32m✓\x1b[0m Authenticated successfully!")
      print("")

      const provider = createChatGPTProviderFromAuth(auth)
      providerRegistry.register(provider)
      await selectChatGPTModel(rl, provider)
    }
  } catch (err) {
    print(`\n  \x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`)
    print("  Please try again with `kumacode connect`.")
  }
}

async function activateChatGPT(rl: readline.Interface): Promise<void> {
  print("  Loading ChatGPT provider...")

  // Dynamic import to avoid circular dependency issues
  const { createChatGPTProvider } = await import("@kumacode/core")
  const provider = await createChatGPTProvider()
  providerRegistry.register(provider)
  await selectChatGPTModel(rl, provider)
}

async function selectChatGPTModel(
  rl: readline.Interface,
  provider: { config: { id: string; models: Array<{ id: string; name: string }> } },
): Promise<void> {
  const models = provider.config.models
  print("  Available models:")
  models.forEach((m, i) => {
    print(`  \x1b[1m${i + 1}.\x1b[0m ${m.name}`)
  })
  print("")

  const modelChoice = await ask(rl, `  Choose model (1-${models.length}) [1]: `)
  const modelIdx = Math.max(0, Math.min(models.length - 1, parseInt(modelChoice || "1", 10) - 1))
  const selectedModel = models[modelIdx]

  providerRegistry.setActive(provider.config.id, selectedModel.id)

  const providerSetting: ProviderSettings = {
    id: "chatgpt",
    name: "ChatGPT (Subscription)",
    type: "chatgpt",
  }
  saveUserSettings({
    provider: "chatgpt",
    model: selectedModel.id,
    providers: [providerSetting],
  })

  print("")
  print(`  \x1b[32m✓\x1b[0m Configured: \x1b[1m${selectedModel.name}\x1b[0m via ChatGPT subscription`)
  print("  \x1b[2mAll API costs are included in your subscription — no per-token charges.\x1b[0m")
  print("  Run \x1b[1mkumacode\x1b[0m to start chatting!")
  print("")
}
