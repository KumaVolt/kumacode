/**
 * Register all built-in tools with the ToolRegistry.
 * Call this once at startup before running the agent loop.
 */
import { toolRegistry } from "./registry.js"
import { readTool } from "./read.js"
import { bashTool } from "./bash.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import { webFetchTool } from "./web-fetch.js"
import { askUserTool } from "./ask-user.js"
import { skillTool } from "../skill/skill-tool.js"
import { taskTool } from "./task.js"

let registered = false

export function registerBuiltinTools(): void {
  if (registered) return
  registered = true

  toolRegistry.register(readTool)
  toolRegistry.register(bashTool)
  toolRegistry.register(writeTool)
  toolRegistry.register(editTool)
  toolRegistry.register(globTool)
  toolRegistry.register(grepTool)
  toolRegistry.register(webFetchTool)
  toolRegistry.register(askUserTool)
  toolRegistry.register(skillTool)
  toolRegistry.register(taskTool)
}
