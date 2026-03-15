"use client"

import * as React from "react"

import {
  fetchLocalSkillRuntimeStatuses,
  isDesktopRuntime,
  type LocalSkillRuntimeStatus,
} from "@/lib/api/plugin-market"

export function useLocalSkillRuntimeStatuses() {
  const [runtimeStatuses, setRuntimeStatuses] = React.useState<
    Record<string, LocalSkillRuntimeStatus>
  >({})
  const hasInstallingRuntime = React.useMemo(
    () => Object.values(runtimeStatuses).some((item) => item.runtime_install_state === "installing"),
    [runtimeStatuses]
  )

  const refreshRuntimeStatuses = React.useCallback(async () => {
    if (!isDesktopRuntime()) return
    try {
      const items = await fetchLocalSkillRuntimeStatuses()
      setRuntimeStatuses(Object.fromEntries(items.map((item) => [item.skill_id, item])))
    } catch (error) {
      console.warn("[plugins] load local skill runtime statuses failed", error)
    }
  }, [])

  React.useEffect(() => {
    void refreshRuntimeStatuses()
  }, [refreshRuntimeStatuses])

  React.useEffect(() => {
    if (!hasInstallingRuntime) return
    const timer = window.setTimeout(() => {
      void refreshRuntimeStatuses()
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [hasInstallingRuntime, refreshRuntimeStatuses])

  return {
    runtimeStatuses,
    hasInstallingRuntime,
    refreshRuntimeStatuses,
  }
}
