import { resolve, relative, isAbsolute } from "node:path"

/**
 * Resolve a path relative to the working directory.
 */
export function resolvePath(cwd: string, filePath: string): string {
  if (isAbsolute(filePath)) return filePath
  return resolve(cwd, filePath)
}

/**
 * Get a relative path from the working directory.
 */
export function relativePath(cwd: string, filePath: string): string {
  return relative(cwd, filePath)
}

/**
 * Check if a path is within the working directory (prevent path traversal).
 */
export function isWithinCwd(cwd: string, filePath: string): boolean {
  const resolved = resolvePath(cwd, filePath)
  return resolved.startsWith(cwd)
}
