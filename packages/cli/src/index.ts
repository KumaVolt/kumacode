#!/usr/bin/env bun

import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { App } from "@kumacode/tui"
import { KumaCode, bus, performSelfUpdate, checkForUpdates } from "@kumacode/core"
import { runConnectWizard } from "./connect.js"

const VERSION = "0.1.0"

const program = new Command()
  .name("kumacode")
  .description("An agentic coding tool that lives in your terminal")
  .version(VERSION)
  .argument("[prompt]", "Initial prompt to send")
  .option("-p, --print", "Non-interactive mode — print response and exit")
  .option("-c, --continue", "Continue the most recent session")
  .option("-r, --resume <id>", "Resume a specific session")
  .option("-m, --model <model>", "Override the model to use")
  .option("--permission-mode <mode>", "Set permission mode: default, acceptEdits, plan")
  .option("--cwd <dir>", "Override working directory")
  .option("--debug", "Enable debug logging")
  .action(async (prompt, options) => {
    const cwd = options.cwd ?? process.cwd()

    if (options.print && prompt) {
      // Non-interactive mode — auto-approve all tool calls (scripted usage)
      const kuma = new KumaCode({
        cwd,
        model: options.model,
        permissionMode: options.permissionMode,
        requestPermission: async () => true,
      })

      await kuma.init()

      const active = kuma.getActiveModel()
      if (!active) {
        console.error("No model configured. Run `kumacode connect` to set one up.")
        process.exit(1)
      }

      // Listen for streaming text
      bus.on("stream:event", (event) => {
        if (event.type === "text_delta" && event.text) {
          process.stdout.write(event.text)
        }
      })

      try {
        await kuma.send(prompt)
        process.stdout.write("\n")
        process.exit(0)
      } catch (err) {
        console.error(
          "\nError:",
          err instanceof Error ? err.message : String(err),
        )
        process.exit(1)
      }
      return
    }

    // Interactive TUI mode
    const { waitUntilExit } = render(
      React.createElement(App, {
        cwd,
        initialPrompt: prompt,
        permissionMode: options.permissionMode,
        resumeSessionId: options.resume,
        continueSession: options.continue,
        modelOverride: options.model,
      }),
    )

    await waitUntilExit()
  })

// Subcommand: connect
program
  .command("connect")
  .description("Configure a model provider")
  .action(async () => {
    await runConnectWizard()
  })

// Subcommand: update
program
  .command("update")
  .description("Update KumaCode to the latest version")
  .option("-f, --force", "Force update check (ignore cache)")
  .action(async (options) => {
    console.log("Checking for updates...")

    // First check if there's an update
    const info = await checkForUpdates(VERSION, { force: options.force ?? true })
    if (info && !info.updateAvailable) {
      console.log(`KumaCode v${VERSION} is already up to date.`)
      process.exit(0)
    }

    if (info) {
      console.log(`Update available: v${info.currentVersion} -> v${info.latestVersion}`)
    }

    console.log("Updating...")
    const result = await performSelfUpdate()

    if (result.success) {
      if (result.newVersion && result.newVersion !== result.previousVersion) {
        console.log(`\nUpdated successfully: v${result.previousVersion} -> v${result.newVersion}`)
        console.log("Restart KumaCode to use the new version.")
      } else {
        console.log(`\n${result.output}`)
      }
    } else {
      console.error(`\nUpdate failed:\n${result.output}`)
      process.exit(1)
    }
  })

program.parse()
