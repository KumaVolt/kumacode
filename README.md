```
  ▄█▄   ▄█▄
 █████████
 █ ▀▄█▄▀ █
 █  ▄▄▄  █
  ▀█████▀
   █▀ █▀
```

# KumaCode

An agentic coding assistant that lives in your terminal. Think Claude Code, but open and provider-agnostic — bring your own model from GitHub Copilot, OpenAI, Google Gemini, Ollama, or any OpenAI-compatible API.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/kumavolt/kumacode/main/install.sh | bash
```

This installs [Bun](https://bun.sh) (if needed), clones the repo, and creates a `kumacode` command in your PATH.

### Manual install

```bash
git clone https://github.com/kumavolt/kumacode.git
cd kumacode
bun install
bun run packages/cli/src/index.ts
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/kumavolt/kumacode/main/uninstall.sh | bash
```

## Quick start

```bash
# First run — connect a model provider
kumacode connect

# Start a conversation
kumacode

# One-shot mode
kumacode -p "explain what this project does"

# Continue where you left off
kumacode -c
```

## Providers

KumaCode supports 7 providers out of the box:

| Provider | Auth | Models |
|---|---|---|
| **GitHub Copilot** | OAuth device flow | GPT-4o, GPT-4.1, Claude Sonnet 4, Claude 3.5 Sonnet, Gemini 2.5 Pro, o3 Mini |
| **OpenAI** | API key | GPT-4.1, GPT-4o, o3, o3-mini, o1, and more |
| **Google Gemini** | API key | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |
| **ChatGPT Plus/Pro** | OAuth (browser + device code) | GPT-4o, o3, o3-mini, and more |
| **Ollama** | Local | Any model you've pulled |
| **OpenAI-compatible** | API key | Groq, Together, OpenRouter, Fireworks, Mistral, DeepSeek, LM Studio |
| **Zhipu AI** | API key | GLM-4 series |

Run `kumacode connect` to set up a provider interactively.

## Tools

The LLM has access to 10 built-in tools:

| Tool | Description |
|---|---|
| **Read** | Read files with line numbers, offset/limit support |
| **Write** | Create or overwrite files (with undo support) |
| **Edit** | Search-and-replace edits (with undo support) |
| **Bash** | Run shell commands |
| **Glob** | Find files by pattern |
| **Grep** | Search file contents with regex |
| **WebFetch** | Fetch and convert web pages |
| **AskUser** | Ask the user a question mid-task |
| **Skill** | Invoke project-specific skills |
| **Task** | Spawn a sub-agent for deep exploration |

## Slash commands

Type these during a conversation:

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/model` | List or switch models |
| `/mode` | Cycle permission mode (default / acceptEdits / plan) |
| `/connect` | Show configured providers |
| `/sessions` | List, resume, or delete sessions |
| `/compact` | Summarize older messages to free context |
| `/undo` | Undo the last file change |
| `/memory` | View or manage learned conventions |
| `/skills` | List available skills |
| `/clear` | Clear conversation |
| `/quit` | Exit |

## Permission modes

Cycle with `Shift+Tab`:

- **default** — asks before file writes and shell commands
- **acceptEdits** — auto-approves file edits, asks for shell commands
- **plan** — read-only mode, the LLM describes changes without making them

## Skills

Skills are reusable prompt templates stored as `SKILL.md` files with YAML frontmatter. The LLM can auto-invoke them, or you can call them directly as slash commands.

```
~/.kumacode/skills/<name>/SKILL.md    # personal (global)
.kumacode/skills/<name>/SKILL.md      # project-specific
```

Example skill:

```markdown
---
name: fix-issue
description: Fix a GitHub issue by number
argument-hint: "<issue-number>"
---

Look up GitHub issue #$ARGUMENTS and fix it. Follow the project's
coding conventions. Run tests after making changes.
```

Then use it: `/fix-issue 42`

See the [Claude Code skills docs](https://docs.anthropic.com/en/docs/claude-code/skills) for the full spec — KumaCode follows the same format.

## Memory

KumaCode learns project conventions over time and stores them in `KUMACODE.md`:

```bash
/memory              # view stored memory
/memory learn        # extract and save learnings from this conversation
/memory add <text>   # manually add a memory entry
```

Memory is stored at:
- **Project:** `KUMACODE.md` or `.kumacode/KUMACODE.md` in your repo
- **User:** `~/.kumacode/KUMACODE.md` (applies to all projects)

## Sub-agents

The **Task** tool lets the LLM spawn isolated sub-agents for deep exploration. Sub-agents get their own conversation and a limited toolset (Read, Glob, Grep, Bash). They're useful for searching large codebases, analyzing multiple files, or answering questions that require reading many files — without polluting the main conversation's context window.

You don't need to do anything — the LLM decides when to use sub-agents automatically.

## Architecture

Bun monorepo with 3 packages:

```
packages/
  core/    # Engine — providers, tools, agent loop, skills, memory, bus
  tui/     # Terminal UI — Ink/React components, markdown rendering
  cli/     # Entrypoint — Commander CLI, connect wizard
```

Key design decisions:
- **Bun** runtime with TypeScript strict mode
- **Ink** (React for terminals) for the TUI
- **mitt** event bus for decoupled communication between core and TUI
- **SQLite** for session persistence
- No Anthropic SDK — provider-agnostic by design
- No axios — native `fetch()` only

## Configuration

```
~/.kumacode/
  settings.json       # user-level config (providers, default model)
  sessions.db         # conversation history
  skills/             # personal skills
  KUMACODE.md         # user-level memory

.kumacode/
  settings.json       # project-level config
  settings.local.json # local overrides (gitignored)
  skills/             # project skills
```

Settings cascade: user < project < local.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `KUMACODE_AUTOCOMPACT_PCT` | `80` | Context window % that triggers auto-compaction (50-95) |
| `KUMACODE_REPO` | (GitHub URL) | Override repo URL for installer |
| `KUMACODE_BRANCH` | `main` | Branch to track for installer |
| `KUMACODE_HOME` | `~/.kumacode/app` | Install location |
| `KUMACODE_BIN_DIR` | `~/.local/bin` | Where to put the launcher |

## License

MIT
