import type { Provider, ProviderConfig, ModelConfig } from "./base.js"

class ProviderRegistry {
  private providers = new Map<string, Provider>()
  private activeProviderId: string | null = null
  private activeModelId: string | null = null

  register(provider: Provider): void {
    this.providers.set(provider.config.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
    if (this.activeProviderId === id) {
      this.activeProviderId = null
      this.activeModelId = null
    }
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id)
  }

  list(): ProviderConfig[] {
    return Array.from(this.providers.values()).map((p) => p.config)
  }

  setActive(providerId: string, modelId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`Provider "${providerId}" not found`)
    const model = provider.config.models.find((m) => m.id === modelId)
    if (!model) throw new Error(`Model "${modelId}" not found in provider "${providerId}"`)
    this.activeProviderId = providerId
    this.activeModelId = modelId
  }

  getActive(): { provider: Provider; model: ModelConfig } | null {
    if (!this.activeProviderId || !this.activeModelId) return null
    const provider = this.providers.get(this.activeProviderId)
    if (!provider) return null
    const model = provider.config.models.find((m) => m.id === this.activeModelId)
    if (!model) return null
    return { provider, model }
  }

  getActiveProvider(): Provider | null {
    if (!this.activeProviderId) return null
    return this.providers.get(this.activeProviderId) ?? null
  }

  getActiveModel(): ModelConfig | null {
    const active = this.getActive()
    return active?.model ?? null
  }
}

export const providerRegistry = new ProviderRegistry()
export { ProviderRegistry }
