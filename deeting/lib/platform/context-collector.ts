"use client"

import { getCurrentWindow } from "@tauri-apps/api/window"
import { arch, platform, type, version } from "@tauri-apps/plugin-os"
import { executableDir, homeDir, tempDir } from "@tauri-apps/api/path"

export interface LocalContextSnapshot {
  os: {
    platform: string
    type: string
    version: string
    arch: string
  }
  env: {
    cwd?: string
    home?: string
    temp?: string
    timestamp: string
    timezone: string
  }
  ui: {
    active_window?: string
    is_focused: boolean
  }
  // Potential future fields for JIT:
  // - local_mcp_status: string[]
  // - active_document_context?: string
}

/**
 * ContextCollector: Gathers real-time desktop environment info
 * to empower backend JIT (Just-In-Time) orchestration.
 */
export async function collectLocalContext(): Promise<LocalContextSnapshot> {
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  
  if (!isTauri) {
    return {
      os: { platform: "web", type: "browser", version: "unknown", arch: "unknown" },
      env: { timestamp: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      ui: { is_focused: true }
    }
  }

  try {
    const window = getCurrentWindow()
    const is_focused = await window.isFocused()
    const label = window.label

    return {
      os: {
        platform: platform(),
        type: type(),
        version: version(),
        arch: arch(),
      },
      env: {
        cwd: await executableDir(),
        home: await homeDir(),
        temp: await tempDir(),
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      ui: {
        active_window: label,
        is_focused,
      }
    }
  } catch (err) {
    console.warn("[ContextCollector] Failed to gather full context", err)
    return {
      os: { platform: "tauri-fallback", type: "unknown", version: "unknown", arch: "unknown" },
      env: { timestamp: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      ui: { is_focused: true }
    }
  }
}
