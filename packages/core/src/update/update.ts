/**
 * Auto-update checker and self-updater for KumaCode.
 *
 * How it works:
 * - On init(), a non-blocking background fetch checks the latest package.json
 *   on the main branch of the GitHub repo.
 * - Compares remote version against local VERSION using semver comparison.
 * - Caches the result to ~/.kumacode/update-check.json so we don't spam GitHub.
 *   Default check interval: once per hour.
 * - If an update is available, emits "update:available" on the bus.
 * - Self-update is just `git pull && bun install` in the install directory.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { bus } from "../bus/bus.js"

const USER_CONFIG_DIR = join(homedir(), ".kumacode")
const UPDATE_CACHE_FILE = join(USER_CONFIG_DIR, "update-check.json")

/** Default interval between update checks — 1 hour in milliseconds */
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** GitHub raw URL for the root package.json on main */
const REMOTE_VERSION_URL =
  "https://raw.githubusercontent.com/anomalyco/kumacode/main/packages/core/package.json"

/** Timeout for the version fetch — don't block startup */
const FETCH_TIMEOUT_MS = 5000

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  checkedAt: number
}

interface UpdateCache {
  latestVersion: string
  checkedAt: number
}

/**
 * Compare two semver strings.
 * Returns: -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

/** Read the cached update check result */
function readCache(): UpdateCache | null {
  try {
    if (!existsSync(UPDATE_CACHE_FILE)) return null
    const raw = readFileSync(UPDATE_CACHE_FILE, "utf-8")
    const data = JSON.parse(raw)
    if (typeof data.latestVersion === "string" && typeof data.checkedAt === "number") {
      return data as UpdateCache
    }
    return null
  } catch {
    return null
  }
}

/** Write the update check result to cache */
function writeCache(cache: UpdateCache): void {
  try {
    if (!existsSync(USER_CONFIG_DIR)) {
      mkdirSync(USER_CONFIG_DIR, { recursive: true })
    }
    writeFileSync(UPDATE_CACHE_FILE, JSON.stringify(cache, null, 2) + "\n")
  } catch {
    // Non-critical — silently ignore write failures
  }
}

/**
 * Fetch the latest version from the remote repository.
 * Returns the version string or null on failure.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(REMOTE_VERSION_URL, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    })
    clearTimeout(timeout)

    if (!response.ok) return null
    const data = await response.json() as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/**
 * Check for updates. Non-blocking, safe to call from init().
 *
 * - If a recent cache exists (within checkIntervalMs), uses cached data.
 * - Otherwise fetches from GitHub.
 * - Emits "update:available" on the bus if an update is found.
 *
 * @returns UpdateInfo or null if check was skipped/failed
 */
export async function checkForUpdates(
  currentVersion: string,
  options?: { checkIntervalMs?: number; force?: boolean },
): Promise<UpdateInfo | null> {
  const checkInterval = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  const force = options?.force ?? false

  // Check cache first
  if (!force) {
    const cache = readCache()
    if (cache && Date.now() - cache.checkedAt < checkInterval) {
      const updateAvailable = compareSemver(currentVersion, cache.latestVersion) < 0
      const info: UpdateInfo = {
        currentVersion,
        latestVersion: cache.latestVersion,
        updateAvailable,
        checkedAt: cache.checkedAt,
      }
      if (updateAvailable) {
        bus.emit("update:available", info)
      }
      return info
    }
  }

  // Fetch latest version
  const latestVersion = await fetchLatestVersion()
  if (!latestVersion) return null

  // Cache the result
  const now = Date.now()
  writeCache({ latestVersion, checkedAt: now })

  const updateAvailable = compareSemver(currentVersion, latestVersion) < 0
  const info: UpdateInfo = {
    currentVersion,
    latestVersion,
    updateAvailable,
    checkedAt: now,
  }

  if (updateAvailable) {
    bus.emit("update:available", info)
  }

  return info
}

/**
 * Perform a self-update by running git pull + bun install in the installation directory.
 *
 * The install directory is determined by:
 * 1. KUMACODE_HOME env var
 * 2. Default: ~/.kumacode/app
 *
 * Returns a result object with success status and output.
 */
export async function performSelfUpdate(): Promise<{
  success: boolean
  output: string
  previousVersion: string
  newVersion: string | null
}> {
  const installDir =
    process.env.KUMACODE_HOME ?? join(homedir(), ".kumacode", "app")

  if (!existsSync(installDir)) {
    return {
      success: false,
      output: `Install directory not found: ${installDir}\nKumaCode may have been installed differently. Try reinstalling with:\n  curl -fsSL https://raw.githubusercontent.com/anomalyco/kumacode/main/install.sh | bash`,
      previousVersion: "",
      newVersion: null,
    }
  }

  // Read current version before update
  let previousVersion = ""
  try {
    const pkgPath = join(installDir, "packages", "core", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    previousVersion = pkg.version ?? "unknown"
  } catch {
    previousVersion = "unknown"
  }

  const outputs: string[] = []

  try {
    // Step 1: git pull
    const gitPull = Bun.spawnSync(["git", "pull", "--ff-only"], {
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const gitOut = gitPull.stdout.toString() + gitPull.stderr.toString()
    outputs.push(`git pull: ${gitOut.trim()}`)

    if (gitPull.exitCode !== 0) {
      return {
        success: false,
        output: outputs.join("\n") + "\n\nGit pull failed. You may have local changes. Try:\n  cd " + installDir + " && git stash && git pull",
        previousVersion,
        newVersion: null,
      }
    }

    // Check if already up to date
    if (gitOut.includes("Already up to date")) {
      return {
        success: true,
        output: "Already up to date.",
        previousVersion,
        newVersion: previousVersion,
      }
    }

    // Step 2: bun install
    const bunPath = process.argv[0] // Use the same bun binary that's running us
    const bunInstall = Bun.spawnSync([bunPath, "install", "--frozen-lockfile"], {
      cwd: installDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const bunOut = bunInstall.stdout.toString() + bunInstall.stderr.toString()
    outputs.push(`bun install: ${bunOut.trim()}`)

    if (bunInstall.exitCode !== 0) {
      // Try without --frozen-lockfile (lockfile might have changed)
      const bunRetry = Bun.spawnSync([bunPath, "install"], {
        cwd: installDir,
        stdout: "pipe",
        stderr: "pipe",
      })
      const retryOut = bunRetry.stdout.toString() + bunRetry.stderr.toString()
      outputs.push(`bun install (retry): ${retryOut.trim()}`)

      if (bunRetry.exitCode !== 0) {
        return {
          success: false,
          output: outputs.join("\n") + "\n\nbun install failed.",
          previousVersion,
          newVersion: null,
        }
      }
    }

    // Read new version after update
    let newVersion: string | null = null
    try {
      const pkgPath = join(installDir, "packages", "core", "package.json")
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      newVersion = pkg.version ?? null
    } catch {
      // ignore
    }

    // Clear the update cache since we just updated
    writeCache({
      latestVersion: newVersion ?? previousVersion,
      checkedAt: Date.now(),
    })

    return {
      success: true,
      output: outputs.join("\n"),
      previousVersion,
      newVersion,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      output: outputs.join("\n") + `\n\nError: ${msg}`,
      previousVersion,
      newVersion: null,
    }
  }
}

/**
 * Get the install directory path (for display purposes).
 */
export function getInstallDir(): string {
  return process.env.KUMACODE_HOME ?? join(homedir(), ".kumacode", "app")
}
