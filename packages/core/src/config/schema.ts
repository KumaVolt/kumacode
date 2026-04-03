import { z } from "zod"

export const PermissionRuleSchema = z.object({
  tool: z.string(),
  pattern: z.string().optional(),
})

export const PermissionsSchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
})

export const ProviderSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["copilot", "openai", "google", "ollama", "compatible", "zhipu", "chatgpt"]),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

export const SettingsSchema = z.object({
  /** Active model identifier */
  model: z.string().optional(),
  /** Active provider id */
  provider: z.string().optional(),
  /** Configured providers */
  providers: z.array(ProviderSettingsSchema).default([]),
  /** Permission rules */
  permissions: PermissionsSchema.default({ allow: [], deny: [] }),
  /** Language for responses */
  language: z.string().optional(),
  /** Custom environment variables */
  env: z.record(z.string()).default({}),
  /** Vim mode enabled */
  vimMode: z.boolean().default(false),
  /** Extended thinking enabled */
  thinkingEnabled: z.boolean().default(false),
  /** Auto-check for updates on startup */
  checkForUpdates: z.boolean().default(true),
})

export type Settings = z.infer<typeof SettingsSchema>
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>
export type Permissions = z.infer<typeof PermissionsSchema>
