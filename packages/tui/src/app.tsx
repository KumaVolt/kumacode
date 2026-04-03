import React, { useEffect, useState, useCallback, useMemo } from "react"
import { Box, useApp, useInput } from "ink"
import { Banner } from "./components/banner.js"
import { Chat } from "./components/chat.js"
import { Input, type SlashCommand } from "./components/input.js"
import { StatusBar } from "./components/status-bar.js"
import { PermissionDialog, type PermissionRequest } from "./components/permission-dialog.js"
import { useKumaCode } from "./hooks/use-kumacode.js"

interface AppProps {
  cwd: string
  initialPrompt?: string
  permissionMode?: "default" | "acceptEdits" | "plan"
  resumeSessionId?: string
  continueSession?: boolean
  modelOverride?: string
}

export function App({
  cwd,
  initialPrompt,
  permissionMode,
  resumeSessionId,
  continueSession,
  modelOverride,
}: AppProps) {
  const { exit } = useApp()
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)

  const requestPermission = useCallback(
    (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        setPendingPermission({
          toolCallId: "",
          name: toolName,
          input,
          resolve: (allowed: boolean) => {
            setPendingPermission(null)
            resolve(allowed)
          },
        })
      })
    },
    [],
  )

  const kuma = useKumaCode({
    cwd,
    permissionMode,
    resumeSessionId,
    continueSession,
    model: modelOverride,
    requestPermission,
  })

  // Handle initial prompt
  useEffect(() => {
    if (initialPrompt) {
      kuma.send(initialPrompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global key bindings
  useInput((input, key) => {
    // Ctrl+D to exit
    if (key.ctrl && input === "d") {
      kuma.abort()
      exit()
    }
    // Ctrl+C: abort streaming, double-tap to exit
    if (key.ctrl && input === "c") {
      if (kuma.isStreaming) {
        kuma.abort()
      } else {
        exit()
      }
    }
    // Escape to abort current request or dismiss permission dialog
    if (key.escape) {
      if (pendingPermission) {
        pendingPermission.resolve(false)
      } else if (kuma.isStreaming) {
        kuma.abort()
      }
    }
    // Shift+Tab to cycle permission mode
    if (key.shift && key.tab) {
      kuma.cyclePermissionMode()
    }
  })

  // Build slash command list for autocomplete (memoized)
  const slashCommands: SlashCommand[] = useMemo(() => {
    const builtinCommands: SlashCommand[] = [
      { name: "help", description: "Show all commands" },
      { name: "clear", description: "Clear conversation" },
      { name: "model", description: "List or switch models" },
      { name: "mode", description: "Cycle permission mode" },
      { name: "connect", description: "Show providers and models" },
      { name: "sessions", description: "List, resume, or delete sessions" },
      { name: "compact", description: "Compact context (summarize)" },
      { name: "undo", description: "Undo last file change" },
      { name: "memory", description: "View or manage learned conventions" },
      { name: "skills", description: "List available skills" },
      { name: "update", description: "Update KumaCode to latest version" },
      { name: "quit", description: "Exit KumaCode" },
    ]

    // Add dynamic skill names
    const skills = kuma.listSkills()
    for (const skill of skills) {
      builtinCommands.push({
        name: skill.name,
        description: skill.description.slice(0, 60),
      })
    }

    return builtinCommands
  }, [kuma])

  // Get recent sessions for the banner
  const recentSessions = useMemo(() => {
    return kuma.listSessions(5)
  }, [kuma])

  const handleSubmit = useCallback((text: string) => {
    // Slash commands
    if (text.startsWith("/")) {
      const [cmd, ...args] = text.slice(1).split(/\s+/)
      const arg = args.join(" ")

      switch (cmd) {
        case "help": {
          const skills = kuma.listSkills()
          const skillHelp = skills.length > 0
            ? "\n\nSkills (invoke via /name):\n" + skills.map((s) =>
                `  /${s.name}${s.argumentHint ? " " + s.argumentHint : ""}  — ${s.description.slice(0, 60)}`
              ).join("\n")
            : ""
          kuma.addLocalMessage(
            "Available slash commands:\n" +
            "  /help       — show this help\n" +
            "  /clear      — clear conversation\n" +
            "  /model      — list or switch models (e.g. /model gpt-4o)\n" +
            "  /mode       — show or cycle permission mode\n" +
            "  /connect    — show configured providers and models\n" +
            "  /sessions   — list, resume, or delete sessions\n" +
            "  /compact    — compact context (summarize older messages)\n" +
            "  /undo       — undo the last file change\n" +
            "  /memory     — view or manage learned conventions\n" +
            "  /skills     — list available skills\n" +
            "  /update     — update KumaCode to the latest version\n" +
            "  /quit       — exit KumaCode" +
            skillHelp
          )
          return
        }
        case "clear":
          kuma.clearMessages()
          return
        case "model": {
          if (!arg) {
            const models = kuma.listModels()
            const active = kuma.model
            if (models.length === 0) {
              kuma.addLocalMessage("No models available. Run `kumacode connect` to set up a provider.")
            } else {
              const lines = models.map((m) =>
                `  ${m.model.name === active ? "* " : "  "}${m.model.id} (${m.providerName})`
              )
              kuma.addLocalMessage("Available models:\n" + lines.join("\n"))
            }
            return
          }
          const ok = kuma.setActiveModel(arg)
          if (!ok) {
            kuma.addLocalMessage(`Model "${arg}" not found. Use /model to list available models.`)
          } else {
            kuma.addLocalMessage(`Switched to model: ${arg}`)
          }
          return
        }
        case "mode":
          kuma.cyclePermissionMode()
          return
        case "connect": {
          const models = kuma.listModels()
          if (models.length === 0) {
            kuma.addLocalMessage(
              "No providers configured.\n" +
              "Run `kumacode connect` from your terminal to set up a provider."
            )
          } else {
            const active = kuma.model
            const providers = new Map<string, string[]>()
            for (const m of models) {
              const list = providers.get(m.providerName) ?? []
              list.push(`  ${m.model.name === active ? "* " : "  "}${m.model.id}`)
              providers.set(m.providerName, list)
            }
            const lines: string[] = []
            for (const [provider, modelLines] of providers) {
              lines.push(`\n  ${provider}:`)
              lines.push(...modelLines)
            }
            kuma.addLocalMessage(
              "Configured providers and models:" +
              lines.join("\n") +
              "\n\nSwitch model: /model <id>\n" +
              "Add a new provider: run `kumacode connect` from your terminal."
            )
          }
          return
        }
        case "compact":
          kuma.compactNow().then((result) => {
            if (result) {
              kuma.addLocalMessage(
                `Context compacted: removed ${result.removed} older messages (method: ${result.method}).`
              )
            } else {
              kuma.addLocalMessage("No messages to compact.")
            }
          }).catch((err) => {
            kuma.addLocalMessage(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          return
        case "undo": {
          const undoCount = kuma.getUndoCount()
          if (undoCount === 0) {
            kuma.addLocalMessage("Nothing to undo. No file changes have been made yet.")
            return
          }
          const result = kuma.undo()
          if (result) {
            const remaining = kuma.getUndoCount()
            kuma.addLocalMessage(
              result + (remaining > 0 ? ` (${remaining} more change${remaining !== 1 ? "s" : ""} can be undone)` : "")
            )
          } else {
            kuma.addLocalMessage("Nothing to undo.")
          }
          return
        }
        case "memory": {
          if (!arg) {
            // Show memory summary
            kuma.addLocalMessage(kuma.getMemorySummary())
            return
          }
          const [subCmd, ...subArgs] = arg.split(/\s+/)
          const memArg = subArgs.join(" ")
          if (subCmd === "learn") {
            kuma.addLocalMessage("Extracting learnings from this conversation...")
            kuma.learnFromConversation(memArg === "user" ? "user" : "project").then((learnings) => {
              if (learnings) {
                kuma.addLocalMessage(
                  `Learned and saved:\n\n${learnings}\n\nSaved to ${memArg === "user" ? "user" : "project"} memory.`
                )
              } else {
                kuma.addLocalMessage("No new learnings extracted from this conversation.")
              }
            }).catch((err) => {
              kuma.addLocalMessage(`Failed to extract learnings: ${err instanceof Error ? err.message : String(err)}`)
            })
            return
          }
          if (subCmd === "add" && memArg) {
            const path = kuma.addMemory(memArg, "project")
            kuma.addLocalMessage(`Memory added to ${path}`)
            return
          }
          kuma.addLocalMessage(
            "Usage:\n" +
            "  /memory         — show stored memory\n" +
            "  /memory learn   — extract and save learnings from this conversation\n" +
            "  /memory learn user — save learnings to user memory\n" +
            "  /memory add <text> — manually add a memory entry"
          )
          return
        }
        case "skills": {
          const skills = kuma.listSkills()
          if (skills.length === 0) {
            kuma.addLocalMessage(
              "No skills loaded.\n\n" +
              "Create a skill:\n" +
              "  mkdir -p .kumacode/skills/my-skill\n" +
              "  # Create .kumacode/skills/my-skill/SKILL.md with instructions\n\n" +
              "Skill locations:\n" +
              "  Personal: ~/.kumacode/skills/<name>/SKILL.md\n" +
              "  Project:  .kumacode/skills/<name>/SKILL.md"
            )
          } else {
            const lines = skills.map((s) => {
              const hint = s.argumentHint ? ` ${s.argumentHint}` : ""
              const src = s.source === "personal" ? "(personal)" : "(project)"
              return `  /${s.name}${hint}  ${src}\n    ${s.description.slice(0, 80)}`
            })
            kuma.addLocalMessage(
              `Available skills (${skills.length}):\n\n` +
              lines.join("\n\n")
            )
          }
          return
        }
        case "update": {
          kuma.addLocalMessage("Checking for updates and updating KumaCode...")
          kuma.performUpdate().then((result) => {
            if (!result) {
              kuma.addLocalMessage("Update check failed: KumaCode not initialized.")
              return
            }
            if (result.success) {
              if (result.newVersion && result.newVersion !== result.previousVersion) {
                kuma.addLocalMessage(
                  `Updated successfully: v${result.previousVersion} -> v${result.newVersion}\n\n` +
                  "Restart KumaCode to use the new version."
                )
              } else {
                kuma.addLocalMessage(result.output)
              }
            } else {
              kuma.addLocalMessage(`Update failed:\n${result.output}`)
            }
          }).catch((err) => {
            kuma.addLocalMessage(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
          })
          return
        }
        case "sessions": {
          if (!arg) {
            // List recent sessions
            const sessions = kuma.listSessions(10)
            if (sessions.length === 0) {
              kuma.addLocalMessage("No saved sessions found.")
            } else {
              const lines = sessions.map((s) => {
                const date = new Date(s.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
                const name = s.name ?? "(unnamed)"
                const shortId = s.id.slice(0, 8)
                return `  ${shortId}  ${date}  ${s.messageCount} msgs  ${s.model}  ${name}`
              })
              kuma.addLocalMessage(
                "Recent sessions:\n" +
                lines.join("\n") +
                "\n\nUsage: /sessions resume <id>  |  /sessions delete <id>"
              )
            }
            return
          }
          const [subCmd, ...subArgs] = arg.split(/\s+/)
          const targetId = subArgs[0]
          if (subCmd === "resume" && targetId) {
            const ok = kuma.resumeSession(targetId)
            if (ok) {
              kuma.addLocalMessage(`Resumed session ${targetId.slice(0, 8)}...`)
            } else {
              // Try partial ID match
              const sessions = kuma.listSessions(50)
              const match = sessions.find((s) => s.id.startsWith(targetId))
              if (match) {
                const ok2 = kuma.resumeSession(match.id)
                if (ok2) {
                  kuma.addLocalMessage(`Resumed session ${match.id.slice(0, 8)}...`)
                } else {
                  kuma.addLocalMessage(`Failed to resume session "${targetId}".`)
                }
              } else {
                kuma.addLocalMessage(`Session "${targetId}" not found. Use /sessions to list.`)
              }
            }
            return
          }
          if (subCmd === "delete" && targetId) {
            // Try exact or partial match
            const sessions = kuma.listSessions(50)
            const match = sessions.find((s) => s.id === targetId || s.id.startsWith(targetId))
            if (match) {
              kuma.deleteSession(match.id)
              kuma.addLocalMessage(`Deleted session ${match.id.slice(0, 8)}...`)
            } else {
              kuma.addLocalMessage(`Session "${targetId}" not found. Use /sessions to list.`)
            }
            return
          }
          kuma.addLocalMessage("Usage: /sessions  |  /sessions resume <id>  |  /sessions delete <id>")
          return
        }
        case "quit":
        case "exit":
          kuma.abort()
          exit()
          return
        default:
          // Check if it's a skill invocation (e.g. /deploy, /fix-issue 123)
          if (kuma.hasSkill(cmd)) {
            const skillContent = kuma.invokeSkill(cmd, arg)
            if (skillContent) {
              // Send the skill content as a user message so the LLM acts on it
              kuma.send(`[Skill: /${cmd}${arg ? " " + arg : ""}]\n\n${skillContent}`)
            } else {
              kuma.addLocalMessage(`Failed to load skill "${cmd}".`)
            }
            return
          }
          kuma.addLocalMessage(`Unknown command: /${cmd}. Type /help for available commands.`)
          return
      }
    }

    kuma.send(text)
  }, [kuma, exit])

  const hasMessages = kuma.messages.length > 0
  const hasActiveSubagent = kuma.subagentActivities.some((a) => a.status === "running")

  return (
    <Box flexDirection="column" width="100%">
      {!hasMessages && (
        <Banner
          cwd={cwd}
          model={kuma.model ?? undefined}
          version={kuma.getVersion()}
          updateInfo={kuma.updateInfo}
          recentSessions={recentSessions}
        />
      )}
      <Chat
        messages={kuma.messages}
        streamingText={kuma.streamingText}
        isStreaming={kuma.isStreaming}
        toolActivities={kuma.toolActivities}
        subagentActivities={kuma.subagentActivities}
        error={kuma.error}
      />
      {pendingPermission && (
        <PermissionDialog request={pendingPermission} />
      )}
      <Input
        onSubmit={handleSubmit}
        disabled={kuma.isStreaming || !!pendingPermission}
        commands={slashCommands}
      />
      <StatusBar
        model={kuma.model ?? undefined}
        mode={kuma.permissionMode}
        tokens={kuma.totalTokens}
        cost={kuma.totalCost}
        undoCount={kuma.getUndoCount()}
        hasSubagent={hasActiveSubagent}
        updateAvailable={!!kuma.updateInfo?.updateAvailable}
        isUpdating={kuma.isUpdating}
      />
    </Box>
  )
}
