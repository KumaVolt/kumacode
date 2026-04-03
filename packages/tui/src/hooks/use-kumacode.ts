/**
 * useKumaCode hook — provides KumaCode instance to TUI components.
 * Creates the instance once and provides methods for sending messages,
 * listening to events, etc.
 */
import { useState, useEffect, useRef, useCallback } from "react"
import {
  KumaCode,
  type KumaCodeOptions,
  bus,
  type Message,
  type StreamEvent,
  type ToolOutput,
  type PermissionMode,
  type ModelConfig,
  type Session,
  type ContentBlock,
  type Skill,
  type UpdateInfo,
} from "@kumacode/core"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  toolResults?: Array<{ toolCallId: string; output: string; isError: boolean }>
  /** Labels of attached images (for display in chat) */
  imageLabels?: string[]
}

export interface ToolActivity {
  toolCallId: string
  name: string
  input: Record<string, unknown>
  status: "running" | "done" | "error"
  output?: ToolOutput
}

export interface SubagentActivity {
  taskId: string
  description: string
  status: "running" | "done" | "error"
  /** Active tool calls within this sub-agent */
  activeTools: Array<{ toolCallId: string; name: string; input: Record<string, unknown> }>
}

export function useKumaCode(options: KumaCodeOptions) {
  const kumaRef = useRef<KumaCode | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [subagentActivities, setSubagentActivities] = useState<SubagentActivity[]>([])
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default")
  const [model, setModel] = useState<string | null>(null)
  const [totalTokens, setTotalTokens] = useState(0)
  const [totalCost, setTotalCost] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // Initialize KumaCode once
  useEffect(() => {
    const kuma = new KumaCode(options)
    kumaRef.current = kuma

    setPermissionMode(kuma.getPermissionMode())

    // Eagerly init providers (async) — sets model name once ready
    kuma.init().then(() => {
      const active = kuma.getActiveModel()
      if (active) {
        setModel(`${active.model.name}`)
      }
      setIsInitializing(false)
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
      setIsInitializing(false)
    })

    return () => {
      kuma.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire up bus events
  useEffect(() => {
    const onStreamEvent = (event: StreamEvent) => {
      if (event.type === "text_delta" && event.text) {
        setStreamingText((prev) => prev + event.text)
      }
    }

    const onAssistantMessage = (msg: Message) => {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((b) => b.text ?? b.output ?? "").join("")
            : ""

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        },
      ])
      // Clear streaming text since we now have the full message
      setStreamingText("")
    }

    const onToolStart = (data: {
      toolCallId: string
      name: string
      input: Record<string, unknown>
    }) => {
      setToolActivities((prev) => [
        ...prev,
        { ...data, status: "running" },
      ])
    }

    const onToolEnd = (data: {
      toolCallId: string
      name: string
      output: ToolOutput
    }) => {
      setToolActivities((prev) =>
        prev.map((a) =>
          a.toolCallId === data.toolCallId
            ? { ...a, status: data.output.isError ? "error" : "done", output: data.output }
            : a,
        ),
      )
    }

    const onAgentStart = () => {
      setIsStreaming(true)
      setStreamingText("")
      setToolActivities([])
      setError(null)
    }

    const onAgentDone = () => {
      setIsStreaming(false)
    }

    const onAgentError = (err: Error) => {
      setIsStreaming(false)
      setError(err.message)
    }

    const onCostUpdate = (data: {
      inputTokens: number
      outputTokens: number
      cost: number
      totalCost: number
    }) => {
      setTotalTokens((prev) => prev + data.inputTokens + data.outputTokens)
      setTotalCost(data.totalCost)
    }

    const onModelChanged = (modelConfig: ModelConfig) => {
      setModel(modelConfig.name)
    }

    const onFileAttached = (data: { paths: string[] }) => {
      // Detect image files in the attached paths
      const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"])
      const imageLabels = data.paths.filter((p) => {
        const ext = p.substring(p.lastIndexOf(".")).toLowerCase()
        return imageExts.has(ext)
      })
      if (imageLabels.length > 0) {
        // Update the most recent user message with image labels
        setMessages((prev) => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "user") {
              updated[i] = { ...updated[i], imageLabels }
              break
            }
          }
          return updated
        })
      }
    }

    const onSubagentStart = (data: { taskId: string; description: string }) => {
      setSubagentActivities((prev) => [
        ...prev,
        { taskId: data.taskId, description: data.description, status: "running", activeTools: [] },
      ])
    }

    const onSubagentEnd = (data: { taskId: string; description: string; success: boolean }) => {
      setSubagentActivities((prev) =>
        prev.map((a) =>
          a.taskId === data.taskId
            ? { ...a, status: data.success ? "done" : "error", activeTools: [] }
            : a,
        ),
      )
    }

    const onSubagentTool = (data: {
      taskId: string
      toolCallId: string
      name: string
      input: Record<string, unknown>
      status: "start" | "done" | "error" | "denied"
    }) => {
      setSubagentActivities((prev) =>
        prev.map((a) => {
          if (a.taskId !== data.taskId) return a
          if (data.status === "start") {
            return {
              ...a,
              activeTools: [...a.activeTools, { toolCallId: data.toolCallId, name: data.name, input: data.input }],
            }
          }
          // Remove from active tools on completion
          return {
            ...a,
            activeTools: a.activeTools.filter((t) => t.toolCallId !== data.toolCallId),
          }
        }),
      )
    }

    const onContextCompacted = (data: { removedCount: number; method: string }) => {
      // Show compaction as a system message in the chat
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: `[Context auto-compacted: ${data.removedCount} older messages summarized (${data.method})]`,
        },
      ])
    }

    const onUpdateAvailable = (info: UpdateInfo) => {
      setUpdateInfo(info)
    }

    const onUpdateStart = () => {
      setIsUpdating(true)
    }

    const onUpdateDone = (data: { success: boolean; output: string; previousVersion: string; newVersion: string | null }) => {
      setIsUpdating(false)
      if (data.success && data.newVersion && data.newVersion !== data.previousVersion) {
        // Clear the update notification and show a chat message
        setUpdateInfo(null)
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: `[Auto-updated: v${data.previousVersion} -> v${data.newVersion}. Restart KumaCode to use the new version.]`,
          },
        ])
      }
    }

    bus.on("stream:event", onStreamEvent)
    bus.on("message:assistant", onAssistantMessage)
    bus.on("tool:start", onToolStart)
    bus.on("tool:end", onToolEnd)
    bus.on("agent:start", onAgentStart)
    bus.on("agent:done", onAgentDone)
    bus.on("agent:error", onAgentError)
    bus.on("cost:update", onCostUpdate)
    bus.on("model:changed", onModelChanged)
    bus.on("file:attached", onFileAttached)
    bus.on("subagent:start", onSubagentStart)
    bus.on("subagent:end", onSubagentEnd)
    bus.on("subagent:tool", onSubagentTool)
    bus.on("context:compacted", onContextCompacted)
    bus.on("update:available", onUpdateAvailable)
    bus.on("update:start", onUpdateStart)
    bus.on("update:done", onUpdateDone)

    return () => {
      bus.off("stream:event", onStreamEvent)
      bus.off("message:assistant", onAssistantMessage)
      bus.off("tool:start", onToolStart)
      bus.off("tool:end", onToolEnd)
      bus.off("agent:start", onAgentStart)
      bus.off("agent:done", onAgentDone)
      bus.off("agent:error", onAgentError)
      bus.off("cost:update", onCostUpdate)
      bus.off("model:changed", onModelChanged)
      bus.off("file:attached", onFileAttached)
      bus.off("subagent:start", onSubagentStart)
      bus.off("subagent:end", onSubagentEnd)
      bus.off("subagent:tool", onSubagentTool)
      bus.off("context:compacted", onContextCompacted)
      bus.off("update:available", onUpdateAvailable)
      bus.off("update:start", onUpdateStart)
      bus.off("update:done", onUpdateDone)
    }
  }, [])

  const send = useCallback(async (text: string) => {
    if (!kumaRef.current) return
    if (isStreaming) return // Don't allow sending while streaming

    // Add user message to display immediately
    setMessages((prev) => [...prev, { role: "user", content: text }])

    try {
      await kumaRef.current.send(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsStreaming(false)
    }
  }, [isStreaming])

  /** Send a message with pre-built content blocks (e.g., text + images) */
  const sendWithBlocks = useCallback(async (displayText: string, blocks: ContentBlock[]) => {
    if (!kumaRef.current) return
    if (isStreaming) return

    // Extract image labels for display
    const imageLabels = blocks
      .filter((b) => b.type === "image" && b.imageLabel)
      .map((b) => b.imageLabel!)

    setMessages((prev) => [...prev, { role: "user", content: displayText, imageLabels }])

    try {
      await kumaRef.current.send(blocks)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsStreaming(false)
    }
  }, [isStreaming])

  const abort = useCallback(() => {
    kumaRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const cyclePermissionMode = useCallback(() => {
    if (!kumaRef.current) return
    const next = kumaRef.current.cyclePermissionMode()
    setPermissionMode(next)
  }, [])

  const clearMessages = useCallback(() => {
    if (!kumaRef.current) return
    kumaRef.current.clearMessages()
    setMessages([])
    setStreamingText("")
    setToolActivities([])
    setError(null)
  }, [])

  const listModels = useCallback(() => {
    if (!kumaRef.current) return []
    return kumaRef.current.listAvailableModels()
  }, [])

  const setActiveModel = useCallback((modelId: string): boolean => {
    if (!kumaRef.current) return false
    return kumaRef.current.setModel(modelId)
  }, [])

  const addLocalMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "assistant" as const, content }])
  }, [])

  const listSessionsFn = useCallback((limit?: number): Session[] => {
    if (!kumaRef.current) return []
    return kumaRef.current.listSessions(limit)
  }, [])

  const resumeSessionFn = useCallback((sessionId: string): boolean => {
    if (!kumaRef.current) return false
    const ok = kumaRef.current.resumeSession(sessionId)
    if (ok) {
      // Rebuild TUI messages from core messages
      const coreMessages = kumaRef.current.getMessages()
      const chatMsgs: ChatMessage[] = coreMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? (m.content as ContentBlock[]).map((b) => b.text ?? b.output ?? "").join("")
              : "",
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
        }))
      setMessages(chatMsgs)
      setStreamingText("")
      setToolActivities([])
      setError(null)
    }
    return ok
  }, [])

  const deleteSessionFn = useCallback((sessionId: string) => {
    if (!kumaRef.current) return
    kumaRef.current.deleteSession(sessionId)
  }, [])

  const compactNow = useCallback(async (): Promise<{ removed: number; method: string } | null> => {
    if (!kumaRef.current) return null
    return kumaRef.current.compactNow()
  }, [])

  const undo = useCallback((): string | null => {
    if (!kumaRef.current) return null
    return kumaRef.current.undoLast()
  }, [])

  const getUndoCount = useCallback((): number => {
    if (!kumaRef.current) return 0
    return kumaRef.current.getUndoCount()
  }, [])

  const listSkills = useCallback((): Skill[] => {
    if (!kumaRef.current) return []
    return kumaRef.current.listSkills()
  }, [])

  const hasSkill = useCallback((name: string): boolean => {
    if (!kumaRef.current) return false
    return kumaRef.current.hasSkill(name)
  }, [])

  const invokeSkill = useCallback((name: string, args: string): string | null => {
    if (!kumaRef.current) return null
    return kumaRef.current.invokeSkill(name, args)
  }, [])

  const getMemorySummary = useCallback((): string => {
    if (!kumaRef.current) return "Not initialized."
    return kumaRef.current.getMemorySummary()
  }, [])

  const learnFromConversation = useCallback(async (scope?: "project" | "user"): Promise<string | null> => {
    if (!kumaRef.current) return null
    return kumaRef.current.learnFromConversation(scope)
  }, [])

  const addMemory = useCallback((text: string, scope?: "project" | "user"): string | null => {
    if (!kumaRef.current) return null
    return kumaRef.current.addMemory(text, scope)
  }, [])

  const performUpdate = useCallback(async (): Promise<{
    success: boolean
    output: string
    previousVersion: string
    newVersion: string | null
  } | null> => {
    if (!kumaRef.current) return null
    return kumaRef.current.performUpdate()
  }, [])

  const getVersion = useCallback((): string => {
    if (!kumaRef.current) return "0.1.0"
    return kumaRef.current.getVersion()
  }, [])

  return {
    messages,
    streamingText,
    isStreaming,
    isInitializing,
    toolActivities,
    subagentActivities,
    permissionMode,
    model,
    totalTokens,
    totalCost,
    error,
    send,
    sendWithBlocks,
    abort,
    cyclePermissionMode,
    clearMessages,
    listModels,
    setActiveModel,
    addLocalMessage,
    listSessions: listSessionsFn,
    resumeSession: resumeSessionFn,
    deleteSession: deleteSessionFn,
    compactNow,
    undo,
    getUndoCount,
    listSkills,
    hasSkill,
    invokeSkill,
    getMemorySummary,
    learnFromConversation,
    addMemory,
    updateInfo,
    isUpdating,
    performUpdate,
    getVersion,
  }
}
