"use client"

import * as React from "react"

import {
  fetchLocalSkillRuntimeStatuses,
  type LocalSkillRuntimeStatus,
} from "@/lib/api/plugin-market"

export function useLocalSkillRuntimeStatuses(desktopSupport: boolean | null) {
  const isDesktop = desktopSupport === true
  const [runtimeStatuses, setRuntimeStatuses] = React.useState<
    Record<string, LocalSkillRuntimeStatus>
  >({})
  const [isLoadingRuntimeStatuses, setIsLoadingRuntimeStatuses] = React.useState(
    desktopSupport !== false
  )
  const hasLoadedRuntimeStatusesRef = React.useRef(false)
  const hasInstallingRuntime = React.useMemo(
    () => Object.values(runtimeStatuses).some((item) => item.runtime_install_state === "installing"),
    [runtimeStatuses]
  )

  const refreshRuntimeStatuses = React.useCallback(async () => {
    if (desktopSupport === null) {
      return
    }

    if (!isDesktop) {
      hasLoadedRuntimeStatusesRef.current = true
      setIsLoadingRuntimeStatuses(false)
      return
    }
    if (!hasLoadedRuntimeStatusesRef.current) {
      setIsLoadingRuntimeStatuses(true)
    }
    try {
      const items = await fetchLocalSkillRuntimeStatuses()
      setRuntimeStatuses(Object.fromEntries(items.map((item) => [item.skill_id, item])))
    } catch (error) {
      console.warn("[plugins] load local skill runtime statuses failed", error)
    } finally {
      hasLoadedRuntimeStatusesRef.current = true
      setIsLoadingRuntimeStatuses(false)
    }
  }, [desktopSupport, isDesktop])

  React.useEffect(() => {
    if (desktopSupport === null) {
      return
    }
    void refreshRuntimeStatuses()
  }, [desktopSupport, refreshRuntimeStatuses])

  React.useEffect(() => {
    if (!isDesktop || !hasInstallingRuntime) return
    const timer = window.setTimeout(() => {
      void refreshRuntimeStatuses()
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [hasInstallingRuntime, isDesktop, refreshRuntimeStatuses])

  return {
    runtimeStatuses,
    isLoadingRuntimeStatuses,
    hasInstallingRuntime,
    refreshRuntimeStatuses,
  }
}
