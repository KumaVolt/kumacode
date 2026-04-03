import React from "react"
import { Box, Text } from "ink"

// Pixel-art bear mascot in Claude Code's chunky style
// Using Unicode block characters for that 8-bit sprite look
export const BEAR_MASCOT = `
  ▄█▄   ▄█▄
 █████████
 █ ▀▄█▄▀ █
 █  ▄▄▄  █
  ▀█████▀
   █▀ █▀
`

interface BannerProps {
  cwd: string
  model?: string
  authType?: string
  version?: string
}

export function Banner({ cwd, model, authType, version = "0.1.0" }: BannerProps) {
  const shortCwd = cwd.replace(process.env.HOME ?? "", "~")

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor="#e8916e"
      paddingX={1}
      paddingY={0}
    >
      {/* Left panel */}
      <Box flexDirection="column" width="50%" alignItems="center" paddingY={1}>
        <Text bold color="#e8916e">
          Welcome back!
        </Text>
        <Text color="#e8916e">{BEAR_MASCOT}</Text>
        <Box flexDirection="column" alignItems="center">
          {model && (
            <Text dimColor>
              {model} · {authType ?? "API"}{" "}
            </Text>
          )}
          <Text dimColor>{shortCwd}</Text>
        </Box>
      </Box>

      {/* Divider */}
      <Box width={1} flexDirection="column">
        <Text color="#e8916e">│</Text>
      </Box>

      {/* Right panel */}
      <Box flexDirection="column" width="50%" paddingX={2} paddingY={1}>
        <Text bold color="#e8916e">
          Tips for getting started
        </Text>
        <Text>Ask Kuma to create a new app or clone a repository</Text>
        <Text> </Text>
        <Text bold color="#e8916e">
          Recent activity
        </Text>
        <Text dimColor>No recent activity</Text>
      </Box>
    </Box>
  )
}

export function WELCOME_BANNER(version: string): string {
  return `KumaCode v${version}`
}
