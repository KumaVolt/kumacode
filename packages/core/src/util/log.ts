type LogLevel = "debug" | "info" | "warn" | "error"

let currentLevel: LogLevel = "info"

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) console.debug("[kumacode:debug]", ...args)
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) console.log("[kumacode]", ...args)
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("warn")) console.warn("[kumacode:warn]", ...args)
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) console.error("[kumacode:error]", ...args)
  },
}
