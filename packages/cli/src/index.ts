#!/usr/bin/env bun

import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { App } from "@kumacode/tui"

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
      // Non-interactive mode — will be implemented with agent loop
      console.log("Non-interactive mode not yet implemented")
      process.exit(0)
    }

    // Interactive TUI mode
    const { waitUntilExit } = render(
      React.createElement(App, {
        cwd,
        initialPrompt: prompt,
      }),
    )

    await waitUntilExit()
  })

// Subcommand: connect
program
  .command("connect")
  .description("Configure a model provider")
  .action(async () => {
    console.log("Connect wizard not yet implemented")
    // Will be implemented with the /connect flow
  })

program.parse()
