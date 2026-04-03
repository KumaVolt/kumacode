/**
 * Diff utility — generates unified diffs for file changes.
 * Uses the `diff` package which is already a dependency of core.
 */
import { createTwoFilesPatch } from "diff"

export interface FileDiff {
  /** The unified diff string */
  unified: string
  /** Number of lines added */
  additions: number
  /** Number of lines removed */
  deletions: number
}

/**
 * Generate a unified diff between old and new file content.
 * Returns a structured diff result, or null if the contents are identical.
 */
export function generateDiff(
  filePath: string,
  oldContent: string | null,
  newContent: string,
): FileDiff | null {
  const old = oldContent ?? ""
  if (old === newContent) return null

  const unified = createTwoFilesPatch(
    filePath,
    filePath,
    old,
    newContent,
    oldContent === null ? "(new file)" : "(before)",
    "(after)",
    { context: 3 },
  )

  // Count additions and deletions
  let additions = 0
  let deletions = 0
  for (const line of unified.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }

  return { unified, additions, deletions }
}
