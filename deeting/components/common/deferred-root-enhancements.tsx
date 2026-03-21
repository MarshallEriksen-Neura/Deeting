"use client"

import dynamic from "next/dynamic"

import { useDeferredMount } from "@/hooks/use-deferred-mount"

const DownloadAppModal = dynamic(
  () => import("@/components/ui/modal/download-app-modal").then((mod) => mod.DownloadAppModal),
  { ssr: false }
)
const DesktopUpdateGuard = dynamic(
  () => import("@/components/common/desktop-update-guard").then((mod) => mod.DesktopUpdateGuard),
  { ssr: false }
)
const BridgeMonitor = dynamic(
  () => import("@/components/bridge/bridge-monitor").then((mod) => mod.BridgeMonitor),
  { ssr: false }
)

type DeferredRootEnhancementsProps = {
  isTauri: boolean
  enableBridgeMonitor: boolean
}

export function DeferredRootEnhancements({
  isTauri,
  enableBridgeMonitor,
}: DeferredRootEnhancementsProps) {
  const isReady = useDeferredMount(120)

  if (!isReady) {
    return null
  }

  return (
    <>
      <DownloadAppModal />
      {isTauri ? <DesktopUpdateGuard /> : null}
      {isTauri && enableBridgeMonitor ? <BridgeMonitor /> : null}
    </>
  )
}
