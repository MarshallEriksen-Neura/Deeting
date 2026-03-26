"use client"

import { useCallback, useEffect, useState } from "react"
import {
  getLocalBrowserAgentBridgeStatus,
  type BrowserAgentBridgeStatus,
} from "@/lib/api/browser-agent"

export type BrowserModeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "extension_not_connected"
  | "unsupported"
  | "error"

function mapConnectionState(
  status: BrowserAgentBridgeStatus | null
): BrowserModeConnectionState {
  if (!status) return "idle"
  if (status.status === "unsupported") return "unsupported"
  if (status.status === "connected" || status.connected_sessions > 0) return "connected"
  if (
    status.status === "listening" &&
    status.running &&
    status.reachable &&
    status.connected_sessions === 0
  ) {
    return "extension_not_connected"
  }
  if (status.status === "start_failed") return "error"
  return "connecting"
}

export function useBrowserModeStatus(enabled: boolean) {
  const [bridgeStatus, setBridgeStatus] = useState<BrowserAgentBridgeStatus | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setBridgeStatus(null)
      return null
    }

    setIsRefreshing(true)
    try {
      const next = await getLocalBrowserAgentBridgeStatus()
      setBridgeStatus(next)
      return next
    } finally {
      setIsRefreshing(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setBridgeStatus(null)
      return
    }

    void refresh()
  }, [enabled, refresh])

  const connectionState = mapConnectionState(bridgeStatus)

  return {
    bridgeStatus,
    isRefreshing,
    refresh,
    connectionState,
    statusLabel: connectionState,
    statusDetail: bridgeStatus?.status_reason ?? null,
  }
}
