/**
 * KumaCode — the high-level session controller.
 *
 * Orchestrates: config loading, tool registration, system prompt building,
 * session persistence, permission checking, and the agent loop.
 *
 * Both TUI and CLI use this as their single interface to the core engine.
 */
import type { Message, ModelConfig, ContentBlock, ImageSource } from "./provider/base.js"
import { providerRegistry } from "./provider/registry.js"
import { registerBuiltinTools } from "./tool/init.js"
import { runAgentLoop, type AgentLoopResult } from "./agent/loop.js"
import { compactMessages, estimateTokens } from "./agent/context.js"
import { bus, type FileBackup } from "./bus/bus.js"
import { loadSettings, loadProjectInstructions, saveUserSettings } from "./config/config.js"
import type { Settings, ProviderSettings } from "./config/schema.js"
import { evaluatePermission } from "./permission/permission.js"
import { type PermissionMode, nextPermissionMode } from "./permission/modes.js"
import {
  createSession as dbCreateSession,
  addMessage as dbAddMessage,
  getSession as dbGetSession,
  getMostRecentSession,
  listSessions as dbListSessions,
  deleteSession as dbDeleteSession,
  updateSessionName as dbUpdateSessionName,
  generateSessionName,
  type Session,
} from "./session/session.js"
import { isGitRepo, getGitBranch, getGitStatus, getGitDiff, getGitStagedDiff, getGitRecentCommits } from "./git/git.js"
import { skillRegistry, type Skill } from "./skill/skill.js"
import {
  readUserMemory,
  readProjectMemory,
  appendProjectMemory,
  appendUserMemory,
  extractLearnings,
  getMemorySummary,
} from "./memory/memory.js"
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs"
import { resolve, relative } from "node:path"
import { createCopilotProvider } from "./provider/copilot.js"
import { createOpenAIProvider } from "./provider/openai.js"
import { createGoogleProvider } from "./provider/google.js"
import { createOllamaProvider } from "./provider/ollama.js"
import { createCompatibleProvider } from "./provider/compatible.js"
import { createZhipuProvider } from "./provider/zhipu.js"
import { createChatGPTProvider } from "./provider/openai-chatgpt.js"
import { checkForUpdates, performSelfUpdate, type UpdateInfo } from "./update/update.js"

const VERSION = "0.1.0"

export interface KumaCodeOptions {
  cwd: string
  /** Override model */
  model?: string
  /** Override permission mode */
  permissionMode?: PermissionMode
  /** Resume a specific session */
  resumeSessionId?: string
  /** Continue the most recent session */
  continueSession?: boolean
  /** Callback for asking the user (TUI wires this up) */
  askUser?: (question: string) => Promise<string>
  /** Callback for permission prompts (TUI wires this up) */
  requestPermission?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<boolean>
}

export class KumaCode {
  readonly cwd: string
  private settings: Settings
  private permissionMode: PermissionMode
  private messages: Message[] = []
  private sessionId: string | null = null
  private askUser?: (question: string) => Promise<string>
  private requestPermission?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<boolean>
  private abortController: AbortController | null = null
  private modelOverride?: string
  private initialized = false
  private initPromise: Promise<void> | null = null
  private sessionNamed = false
  private fileBackups: FileBackup[] = []

  constructor(options: KumaCodeOptions) {
    this.cwd = options.cwd
    this.askUser = options.askUser
    this.requestPermission = options.requestPermission
    this.modelOverride = options.model

    // Load config
    this.settings = loadSettings(this.cwd)
    this.permissionMode = options.permissionMode ?? "default"

    // Register tools
    registerBuiltinTools()

    // Load skills from personal + project directories
    skillRegistry.loadAll(this.cwd)

    // Listen for file modifications (for undo support)
    bus.on("file:modified", (backup) => {
      this.fileBackups.push(backup)
    })

    // Resume or continue session if requested
    if (options.resumeSessionId) {
      const session = dbGetSession(options.resumeSessionId)
      if (session) {
        this.sessionId = session.id
        this.messages = session.messages
        this.sessionNamed = true // already named from first creation
        bus.emit("session:resumed", { id: session.id })
      }
    } else if (options.continueSession) {
      const session = getMostRecentSession()
      if (session) {
        const full = dbGetSession(session.id)
        if (full) {
          this.sessionId = full.id
          this.messages = full.messages
          this.sessionNamed = true
          bus.emit("session:resumed", { id: full.id })
        }
      }
    }
  }

  /**
   * Async initialization — restores providers from saved settings,
   * then applies model override. Call eagerly from the TUI/CLI for
   * fast model display, or let send() call it lazily.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    // Restore providers from saved settings
    const errors: string[] = []

    for (const ps of this.settings.providers) {
      try {
        switch (ps.type) {
          case "copilot": {
            const provider = await createCopilotProvider(ps.apiKey)
            providerRegistry.register(provider)
            break
          }
          case "openai": {
            if (!ps.apiKey) break
            const provider = createOpenAIProvider(ps.apiKey)
            providerRegistry.register(provider)
            break
          }
          case "google": {
            if (!ps.apiKey) break
            const provider = createGoogleProvider(ps.apiKey)
            providerRegistry.register(provider)
            break
          }
          case "ollama": {
            // Ollama doesn't need an API key — just try to connect
            const provider = createOllamaProvider(ps.baseUrl)
            providerRegistry.register(provider)
            break
          }
          case "compatible": {
            if (!ps.apiKey || !ps.baseUrl) break
            const provider = createCompatibleProvider({
              name: ps.name,
              baseUrl: ps.baseUrl,
              apiKey: ps.apiKey,
            })
            providerRegistry.register(provider)
            break
          }
          case "zhipu": {
            if (!ps.apiKey) break
            const provider = createZhipuProvider(ps.apiKey)
            providerRegistry.register(provider)
            break
          }
          case "chatgpt": {
            const provider = await createChatGPTProvider()
            providerRegistry.register(provider)
            break
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`Failed to init provider "${ps.name}": ${msg}`)
      }
    }

    // Log any provider init errors (non-fatal — other providers may still work)
    for (const err of errors) {
      bus.emit("agent:error", new Error(err))
    }

    // Set active provider/model from settings or override
    this.applyActiveModel()

    // Non-blocking auto-update — check for updates, then auto-apply in background
    if (this.settings.checkForUpdates) {
      this.backgroundAutoUpdate()
    }

    this.initialized = true
    this.initPromise = null
  }

  /**
   * Background auto-update: check for a new version and auto-apply it.
   * Runs entirely in the background — never blocks init() or send().
   * Emits bus events so the TUI can show a notification when done.
   */
  private backgroundAutoUpdate(): void {
    checkForUpdates(VERSION)
      .then((info) => {
        if (!info?.updateAvailable) return

        // New version found — auto-apply
        bus.emit("update:start", undefined)
        return performSelfUpdate().then((result) => {
          bus.emit("update:done", result)
        })
      })
      .catch(() => {
        // Silently ignore — auto-update is best-effort
      })
  }

  /**
   * Apply model override or restore active model from settings.
   */
  private applyActiveModel(): void {
    const modelToFind = this.modelOverride ?? this.settings.model
    const providerToFind = this.settings.provider

    if (modelToFind) {
      // Find the model across all registered providers
      for (const config of providerRegistry.list()) {
        const model = config.models.find((m) => m.id === modelToFind)
        if (model) {
          providerRegistry.setActive(config.id, model.id)
          bus.emit("model:changed", model)
          return
        }
      }
    }

    // If a preferred provider is set but no model override, pick its first model
    if (providerToFind) {
      const config = providerRegistry.list().find((c) => c.id === providerToFind)
      if (config && config.models.length > 0) {
        providerRegistry.setActive(config.id, config.models[0].id)
        bus.emit("model:changed", config.models[0])
        return
      }
    }

    // Fallback: pick the first model from the first provider
    const allConfigs = providerRegistry.list()
    if (allConfigs.length > 0 && allConfigs[0].models.length > 0) {
      providerRegistry.setActive(allConfigs[0].id, allConfigs[0].models[0].id)
      bus.emit("model:changed", allConfigs[0].models[0])
    }
  }

  /** Get the current active model info */
  getActiveModel(): { provider: string; model: ModelConfig } | null {
    const active = providerRegistry.getActive()
    if (!active) return null
    return { provider: active.provider.config.name, model: active.model }
  }

  /** Get current permission mode */
  getPermissionMode(): PermissionMode {
    return this.permissionMode
  }

  /** Cycle to next permission mode (Shift+Tab) */
  cyclePermissionMode(): PermissionMode {
    this.permissionMode = nextPermissionMode(this.permissionMode)
    return this.permissionMode
  }

  /** Set a specific permission mode */
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode
  }

  /** Get the current session ID */
  getSessionId(): string | null {
    return this.sessionId
  }

  /** Get message count */
  getMessageCount(): number {
    return this.messages.length
  }

  /** Get the current messages (for TUI session restore) */
  getMessages(): readonly Message[] {
    return this.messages
  }

  /** Clear conversation messages (start fresh within same session) */
  clearMessages(): void {
    this.messages = []
    this.sessionId = null
    this.sessionNamed = false
  }

  /** List user-invocable skills (for /slash command menu) */
  listSkills(): Skill[] {
    return skillRegistry.listUserInvocable()
  }

  /** Invoke a skill by name with arguments, returning its resolved content */
  invokeSkill(name: string, args: string): string | null {
    return skillRegistry.resolve(name, args)
  }

  /** Check if a skill exists */
  hasSkill(name: string): boolean {
    return skillRegistry.has(name)
  }

  /** List recent sessions */
  listSessions(limit = 20): Session[] {
    return dbListSessions(limit)
  }

  /** Resume a specific session by ID, loading its messages */
  resumeSession(sessionId: string): boolean {
    const session = dbGetSession(sessionId)
    if (!session) return false
    this.sessionId = session.id
    this.messages = session.messages
    this.sessionNamed = true
    bus.emit("session:resumed", { id: session.id })
    return true
  }

  /** Delete a session by ID */
  deleteSession(sessionId: string): void {
    dbDeleteSession(sessionId)
    // If we just deleted the active session, clear state
    if (this.sessionId === sessionId) {
      this.messages = []
      this.sessionId = null
    }
  }

  /** Force context compaction — summarizes older messages using the LLM */
  async compactNow(): Promise<{ removed: number; method: string }> {
    const active = providerRegistry.getActive()
    if (!active) throw new Error("No active provider to use for compaction.")

    const before = this.messages.length
    const tokensBefore = estimateTokens(this.messages)
    const threshold = Math.floor(active.model.contextWindow * 0.5) // Use 50% as target for manual compaction

    const compacted = await compactMessages(this.messages, threshold, {
      provider: active.provider,
      modelId: active.model.id,
    })

    this.messages = compacted
    const removed = before - compacted.length
    const tokensAfter = estimateTokens(compacted)
    const method = compacted[0]?.content?.toString().includes("LLM summary") ? "llm" : "truncate"

    return { removed, method }
  }

  /** List all available models across all registered providers */
  listAvailableModels(): Array<{ providerId: string; providerName: string; model: ModelConfig }> {
    const result: Array<{ providerId: string; providerName: string; model: ModelConfig }> = []
    for (const config of providerRegistry.list()) {
      for (const model of config.models) {
        result.push({ providerId: config.id, providerName: config.name, model })
      }
    }
    return result
  }

  /** Switch to a specific model by ID */
  setModel(modelId: string): boolean {
    for (const config of providerRegistry.list()) {
      const model = config.models.find((m) => m.id === modelId)
      if (model) {
        providerRegistry.setActive(config.id, model.id)
        bus.emit("model:changed", model)
        return true
      }
    }
    return false
  }

  /** Send a user message and run the agent loop.
   *  Accepts plain text or ContentBlock[] (e.g., text + images from the TUI).
   */
  async send(userInput: string | ContentBlock[]): Promise<AgentLoopResult> {
    // Ensure providers are initialized
    await this.init()

    // Create session on first message if needed
    if (!this.sessionId) {
      const active = providerRegistry.getActive()
      if (active) {
        const session = dbCreateSession(
          active.model.id,
          active.provider.config.id,
          this.cwd,
        )
        this.sessionId = session.id
        bus.emit("session:created", { id: session.id })
      }
    }

    // Build the message content: either expand @file mentions (string)
    // or pass through pre-built content blocks
    let messageContent: string | ContentBlock[]
    if (typeof userInput === "string") {
      messageContent = this.expandFileMentions(userInput)
    } else {
      messageContent = userInput
    }

    // Add user message
    const userMessage: Message = { role: "user", content: messageContent }
    this.messages.push(userMessage)
    bus.emit("message:user", userMessage)

    // Persist user message
    if (this.sessionId) {
      dbAddMessage(this.sessionId, userMessage)
    }

    // Create abort controller
    this.abortController = new AbortController()

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt()

    // Run agent loop
    const messageCountBefore = this.messages.length
    const result = await runAgentLoop(this.messages, {
      cwd: this.cwd,
      systemPrompt,
      abortSignal: this.abortController.signal,
      checkPermission: async (toolName, input) => {
        const level = evaluatePermission(
          toolName,
          input,
          this.permissionMode,
          this.settings.permissions,
        )
        if (level === "allowed") return true
        if (level === "denied") return false
        // level === "ask" — delegate to TUI/CLI
        if (this.requestPermission) {
          return this.requestPermission(toolName, input)
        }
        // No UI callback — deny by default
        return false
      },
    })

    // Update messages with the full result
    this.messages = result.messages

    // Persist new messages added by the agent loop
    if (this.sessionId) {
      const addedMessages = result.messages.slice(messageCountBefore)
      for (const msg of addedMessages) {
        dbAddMessage(this.sessionId, msg)
      }

      // Auto-name the session after the first exchange
      if (!this.sessionNamed) {
        this.sessionNamed = true
        const firstUserText = typeof messageContent === "string"
          ? messageContent
          : messageContent
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join(" ")
        if (firstUserText.trim()) {
          const name = generateSessionName(firstUserText)
          dbUpdateSessionName(this.sessionId, name)
        }
      }
    }

    this.abortController = null
    return result
  }

  /** Abort the current agent loop */
  abort(): void {
    this.abortController?.abort()
  }

  /** Get the number of undoable file changes */
  getUndoCount(): number {
    return this.fileBackups.length
  }

  /**
   * Undo the last file modification.
   * Restores the file to its previous content, or deletes it if it was newly created.
   * Returns a description of what was undone, or null if nothing to undo.
   */
  undoLast(): string | null {
    const backup = this.fileBackups.pop()
    if (!backup) return null

    try {
      if (backup.previousContent === null) {
        // File was newly created — delete it
        if (existsSync(backup.filePath)) {
          unlinkSync(backup.filePath)
          return `Deleted ${backup.filePath} (was created by ${backup.toolName})`
        }
        return `File ${backup.filePath} already removed`
      }

      // Restore previous content
      writeFileSync(backup.filePath, backup.previousContent, "utf-8")
      return `Restored ${backup.filePath} (undid ${backup.toolName})`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return `Failed to undo ${backup.filePath}: ${msg}`
    }
  }

  /** Get a formatted summary of all stored memory (user + project) */
  getMemorySummary(): string {
    return getMemorySummary(this.cwd)
  }

  /**
   * Extract learnings from the current conversation and save to project memory.
   * Returns the learnings text if any were found, or null.
   */
  async learnFromConversation(scope: "project" | "user" = "project"): Promise<string | null> {
    const active = providerRegistry.getActive()
    if (!active) return null
    if (this.messages.length < 4) return null

    const learnings = await extractLearnings(this.messages, active.provider, active.model.id)
    if (!learnings) return null

    if (scope === "user") {
      appendUserMemory(learnings)
    } else {
      appendProjectMemory(this.cwd, learnings)
    }

    return learnings
  }

  /**
   * Manually add a memory entry.
   */
  addMemory(text: string, scope: "project" | "user" = "project"): string {
    if (scope === "user") {
      return appendUserMemory(text)
    }
    return appendProjectMemory(this.cwd, text)
  }

  /**
   * Force an update check right now (ignores cache).
   * Returns the update info if a check was performed, or null on failure.
   */
  async checkForUpdatesNow(): Promise<UpdateInfo | null> {
    return checkForUpdates(VERSION, { force: true })
  }

  /**
   * Perform a self-update: git pull + bun install in the install directory.
   * Emits "update:start" and "update:done" bus events.
   */
  async performUpdate(): Promise<{
    success: boolean
    output: string
    previousVersion: string
    newVersion: string | null
  }> {
    bus.emit("update:start", undefined)
    const result = await performSelfUpdate()
    bus.emit("update:done", result)
    return result
  }

  /** Get the current KumaCode version */
  getVersion(): string {
    return VERSION
  }

  /** Known image file extensions */
  private static IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"])

  /** Map file extension to MIME type */
  private static imageMediaType(ext: string): ImageSource["mediaType"] | null {
    switch (ext.toLowerCase()) {
      case ".png": return "image/png"
      case ".jpg":
      case ".jpeg": return "image/jpeg"
      case ".gif": return "image/gif"
      case ".webp": return "image/webp"
      default: return null
    }
  }

  /**
   * Parse @path/to/file mentions in user text, read the files,
   * and return either expanded text (string) or content blocks
   * (ContentBlock[]) if images are present.
   *
   * Rules:
   * - Matches @<path> where path contains word chars, dots, slashes, hyphens, tildes
   * - Does NOT match email-like patterns (preceded by a word char)
   * - Paths are resolved relative to this.cwd
   * - Image files (.png, .jpg, .jpeg, .gif, .webp) are read as base64 and returned as image blocks
   * - Text files are appended as text context
   * - Directories are skipped (mentioned but not read)
   * - Missing files produce a note instead of crashing
   * - A bus event is emitted listing attached files
   * - Size limits: 256 KB for text files, 10 MB for images
   */
  private expandFileMentions(text: string): string | ContentBlock[] {
    // Match @path at word boundary — but not email (preceded by a word char)
    const mentionRegex = /(?<![a-zA-Z0-9_.])@([\w.\/\-~][^\s,;:'")\]}>]*)/g
    const mentions: Array<{ match: string; path: string; resolved: string }> = []
    const seen = new Set<string>()

    let m: RegExpExecArray | null
    while ((m = mentionRegex.exec(text)) !== null) {
      const rawPath = m[1]
      // Strip trailing punctuation that's unlikely to be part of a filename
      const cleanPath = rawPath.replace(/[.,!?;:]+$/, "")
      if (!cleanPath) continue

      const resolved = resolve(this.cwd, cleanPath)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      mentions.push({ match: m[0], path: cleanPath, resolved })
    }

    if (mentions.length === 0) return text

    const textAttachments: string[] = []
    const imageBlocks: ContentBlock[] = []
    const attachedPaths: string[] = []
    let hasImages = false

    for (const mention of mentions) {
      try {
        if (!existsSync(mention.resolved)) {
          textAttachments.push(`\n\n--- @${mention.path} (file not found) ---`)
          continue
        }

        const stat = statSync(mention.resolved)
        if (stat.isDirectory()) {
          textAttachments.push(`\n\n--- @${mention.path} (directory — not expanded) ---`)
          continue
        }

        const ext = mention.path.substring(mention.path.lastIndexOf(".")).toLowerCase()
        const mediaType = KumaCode.imageMediaType(ext)

        if (mediaType) {
          // Image file — read as base64
          if (stat.size > 10 * 1024 * 1024) {
            textAttachments.push(`\n\n--- @${mention.path} (image too large: ${Math.round(stat.size / (1024 * 1024))} MB, max 10 MB) ---`)
            continue
          }
          const data = readFileSync(mention.resolved).toString("base64")
          const relPath = relative(this.cwd, mention.resolved) || mention.path
          imageBlocks.push({
            type: "image",
            imageSource: {
              type: "base64",
              mediaType,
              data,
            },
            imageLabel: relPath,
          })
          attachedPaths.push(relPath)
          hasImages = true
        } else {
          // Text file
          if (stat.size > 256 * 1024) {
            textAttachments.push(`\n\n--- @${mention.path} (file too large: ${Math.round(stat.size / 1024)} KB, max 256 KB) ---`)
            continue
          }
          const content = readFileSync(mention.resolved, "utf-8")
          const relPath = relative(this.cwd, mention.resolved) || mention.path
          textAttachments.push(`\n\n--- @${relPath} ---\n${content}\n--- end @${relPath} ---`)
          attachedPaths.push(relPath)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        textAttachments.push(`\n\n--- @${mention.path} (error reading: ${msg}) ---`)
      }
    }

    if (attachedPaths.length > 0) {
      bus.emit("file:attached", { paths: attachedPaths })
    }

    // If there are images, return ContentBlock[] so providers can encode them properly
    if (hasImages) {
      const blocks: ContentBlock[] = []
      // Text content (user text + any text file attachments)
      const fullText = text + textAttachments.join("")
      if (fullText.trim()) {
        blocks.push({ type: "text", text: fullText })
      }
      // Image blocks
      blocks.push(...imageBlocks)
      return blocks
    }

    // No images — return plain string
    return text + textAttachments.join("")
  }

  /** Build the system prompt with context */
  private buildSystemPrompt(): string {
    const parts: string[] = []

    // Identity
    parts.push(`You are KumaCode, an interactive CLI coding assistant (v${VERSION}).`)
    parts.push("You help users with software engineering tasks: fixing bugs, writing features, refactoring, explaining code, and more.")
    parts.push("")

    // Environment context
    parts.push("## Environment")
    parts.push(`- Working directory: ${this.cwd}`)
    const gitRepo = isGitRepo(this.cwd)
    if (gitRepo) {
      const branch = getGitBranch(this.cwd)
      parts.push(`- Git repository: yes${branch ? `, branch: ${branch}` : ""}`)

      // Git status (working tree changes)
      const status = getGitStatus(this.cwd)
      if (status) {
        parts.push("")
        parts.push("### Git Status (working tree)")
        parts.push("```")
        parts.push(status)
        parts.push("```")
      }

      // Git staged changes
      const staged = getGitStagedDiff(this.cwd)
      if (staged) {
        parts.push("")
        parts.push("### Git Staged Changes")
        parts.push("```")
        parts.push(staged)
        parts.push("```")
      }

      // Unstaged diff stat
      const diff = getGitDiff(this.cwd)
      if (diff) {
        parts.push("")
        parts.push("### Git Unstaged Diff")
        parts.push("```")
        parts.push(diff)
        parts.push("```")
      }

      // Recent commits
      const commits = getGitRecentCommits(this.cwd)
      if (commits) {
        parts.push("")
        parts.push("### Recent Commits")
        parts.push("```")
        parts.push(commits)
        parts.push("```")
      }
    } else {
      parts.push("- Git repository: no")
    }
    parts.push(`- Platform: ${process.platform}`)
    parts.push(`- Date: ${new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}`)
    parts.push("")

    // Tool guidance
    parts.push("## Guidelines")
    parts.push("- Use tools to read, write, and search files. Prefer precise edits over full file rewrites.")
    parts.push("- Before editing a file, read it first to understand its content and structure.")
    parts.push("- Use Glob and Grep to find files and content instead of guessing paths.")
    parts.push("- Use Bash for running commands (build, test, git, etc.).")
    parts.push("- Give concise, direct answers. Explain reasoning when helpful.")
    parts.push("- When making changes, verify them (e.g., run tests, type-check).")
    parts.push("- If a task is ambiguous, ask the user for clarification using the AskUser tool.")
    parts.push("")

    // Permission mode context
    parts.push(`## Permission Mode: ${this.permissionMode}`)
    if (this.permissionMode === "plan") {
      parts.push("You are in PLAN mode. You can read and search files but cannot write files or run commands. Describe what changes you would make instead of making them.")
    } else if (this.permissionMode === "acceptEdits") {
      parts.push("File edits are auto-approved. Shell commands still require user approval.")
    }
    parts.push("")

    // Project instructions (KUMACODE.md)
    const instructions = loadProjectInstructions(this.cwd)
    if (instructions) {
      parts.push("## Project Instructions (from KUMACODE.md)")
      parts.push(instructions)
      parts.push("")
    }

    // User-level memory (~/.kumacode/KUMACODE.md)
    const userMemory = readUserMemory()
    if (userMemory) {
      parts.push("## User Preferences (from ~/.kumacode/KUMACODE.md)")
      parts.push(userMemory)
      parts.push("")
    }

    // Skills context — list available skills so the LLM can auto-invoke
    const skillContext = skillRegistry.buildSystemPromptContext()
    if (skillContext) {
      parts.push(skillContext)
      parts.push("")
    }

    return parts.join("\n")
  }
}
