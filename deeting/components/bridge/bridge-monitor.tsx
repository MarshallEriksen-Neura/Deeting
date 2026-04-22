"use client"

import { useBridgeMonitor } from "@/hooks/use-bridge-monitor"

/**
 * Bridge Monitor Component
 * A headless component that runs in the background to handle 
 * Cloud -> Local tool execution requests.
 */
export function BridgeMonitor() {
  // Use the hook to start listening
  useBridgeMonitor()
  
  // This component doesn't render anything
  return null
}
