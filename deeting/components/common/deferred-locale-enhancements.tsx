"use client"

import dynamic from "next/dynamic"

import { useDeferredMount } from "@/hooks/use-deferred-mount"

const AppLoadingOverlay = dynamic(
  () => import("@/components/common/app-loading-overlay").then((mod) => mod.AppLoadingOverlay),
  { ssr: false }
)
const NotificationSystem = dynamic(
  () => import("@/components/notifications/notification-system").then((mod) => mod.NotificationSystem),
  { ssr: false }
)
const DesktopCloseGuard = dynamic(
  () => import("@/components/common/desktop-close-guard").then((mod) => mod.DesktopCloseGuard),
  { ssr: false }
)
const DesktopTrayLocaleSync = dynamic(
  () => import("@/components/common/desktop-tray-locale-sync").then((mod) => mod.DesktopTrayLocaleSync),
  { ssr: false }
)

type DeferredLocaleEnhancementsProps = {
  isTauri: boolean
}

export function DeferredLocaleEnhancements({
  isTauri,
}: DeferredLocaleEnhancementsProps) {
  const isReady = useDeferredMount()

  if (!isReady) {
    return null
  }

  return (
    <>
      <AppLoadingOverlay />
      {isTauri ? <DesktopCloseGuard /> : null}
      {isTauri ? <DesktopTrayLocaleSync /> : null}
      <NotificationSystem />
    </>
  )
}
