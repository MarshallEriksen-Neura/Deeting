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

  return {
    runtimeStatuses,
    refreshRuntimeStatuses,
  }
}
