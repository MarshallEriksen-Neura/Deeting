import { useCallback, useEffect, useMemo, useRef } from "react"
import useSWR from "swr"
import useSWRMutation from "swr/mutation"

import {
  createSpecDraft,
  fetchSpecPlanDetail,
  fetchSpecPlanStatus,
  interactSpecPlan,
  startSpecPlan,
  streamSpecDraft,
  updateSpecPlanNode,
  type SpecDraftRequest,
  type SpecPlanDetail,
  type SpecPlanStatus,
  type SpecPlanNodeUpdateResponse,
} from "@/lib/api/spec-agent"
import { useSpecAgentStore } from "@/store/spec-agent-store"
import type { ApiError } from "@/lib/http"

const SPEC_PLAN_DETAIL_KEY = "/api/v1/spec-agent/plans/detail"
const SPEC_PLAN_STATUS_KEY = "/api/v1/spec-agent/plans/status"

export function useSpecDraftStream() {
  const cancelRef = useRef<null | (() => void)>(null)
  const {
    startDrafting,
    setDraftingError,
    setPlanInit,
    setPlanReady,
    setPlanDetail,
    applyNodeAdded,
    applyLinkAdded,
  } = useSpecAgentStore()

  const start = useCallback(
    (payload: SpecDraftRequest) => {
      cancelRef.current?.()
      startDrafting()

      cancelRef.current = streamSpecDraft(
        payload,
        {
          onEvent: (event) => {
            switch (event.event) {
              case "drafting":
                return
              case "plan_init":
                setPlanInit(event.data.plan_id, event.data.project_name ?? null)
                return
              case "node_added":
                applyNodeAdded(event.data.node)
                return
              case "link_added":
                applyLinkAdded({ source: event.data.source, target: event.data.target })
                return
              case "plan_ready":
                setPlanReady(event.data.plan_id)
                void fetchSpecPlanDetail(event.data.plan_id)
                  .then((detail) => {
                    setPlanDetail({
                      planId: detail.id,
                      projectName: detail.project_name,
                      manifest: detail.manifest,
                      connections: detail.connections,
                      execution: detail.execution,
                    })
                  })
                  .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : "加载规划失败"
                    setDraftingError(message)
                  })
                return
              case "plan_error":
                setDraftingError(event.data.message ?? "规划失败")
                return
              default:
                return
            }
          },
          onError: (err) => {
            setDraftingError(err.message)
          },
        },
        {
          onCancel: (cancel) => {
            cancelRef.current = cancel
          },
        }
      )
    },
    [
      applyLinkAdded,
      applyNodeAdded,
      setDraftingError,
      setPlanDetail,
      setPlanInit,
      setPlanReady,
      startDrafting,
    ]
  )

  const stop = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      cancelRef.current?.()
    }
  }, [])

  return { start, stop }
}

export function useSpecDraftOnce() {
  const { setPlanDetail, setDraftingError, startDrafting } = useSpecAgentStore()
  const start = useCallback(
    async (payload: SpecDraftRequest) => {
      startDrafting()
      try {
        const draft = await createSpecDraft(payload, { stream: false })
        setPlanDetail({
          planId: draft.plan_id,
          projectName: draft.manifest.project_name,
          manifest: draft.manifest,
          connections: [],
          execution: { status: "drafting", progress: 0 },
        })
        return draft
      } catch (err) {
        const message = err instanceof Error ? err.message : "规划失败"
        setDraftingError(message)
        throw err
      }
    },
    [setDraftingError, setPlanDetail, startDrafting]
  )

  return { start }
}

export function useSpecPlanDetail(planId: string | null, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false && !!planId
  const key = enabled ? [SPEC_PLAN_DETAIL_KEY, planId] : null
  const swr = useSWR<SpecPlanDetail, ApiError>(
    key,
    () => fetchSpecPlanDetail(planId as string),
    { revalidateOnFocus: false }
  )

  const { setPlanDetail } = useSpecAgentStore()
  useEffect(() => {
    if (!swr.data) return
    setPlanDetail({
      planId: swr.data.id,
      projectName: swr.data.project_name,
      manifest: swr.data.manifest,
      connections: swr.data.connections,
      execution: swr.data.execution,
    })
  }, [swr.data, setPlanDetail])

  return swr
}

export function useSpecPlanStatus(
  planId: string | null,
  options: { enabled?: boolean; refreshInterval?: number } = {}
) {
  const { setExecution, setCheckpoint, applyStatusNodes } = useSpecAgentStore()
  const enabled = options.enabled !== false && !!planId
  const key = enabled ? [SPEC_PLAN_STATUS_KEY, planId] : null
  const swr = useSWR<SpecPlanStatus, ApiError>(
    key,
    () => fetchSpecPlanStatus(planId as string),
    {
      refreshInterval: options.refreshInterval ?? 2000,
      revalidateOnFocus: true,
      dedupingInterval: 500,
    }
  )

  useEffect(() => {
    if (!swr.data) return
    setExecution(swr.data.execution)
    setCheckpoint((swr.data.checkpoint as Record<string, unknown>) ?? null)
    applyStatusNodes(swr.data.nodes)
  }, [applyStatusNodes, setCheckpoint, setExecution, swr.data])

  return swr
}

export function useSpecPlanActions(planId: string | null) {
  const { setExecution } = useSpecAgentStore()
  const start = useSWRMutation(
    planId ? `${SPEC_PLAN_DETAIL_KEY}/${planId}/start` : null,
    () => startSpecPlan(planId as string)
  )

  const interact = useSWRMutation(
    planId ? `${SPEC_PLAN_DETAIL_KEY}/${planId}/interact` : null,
    (_key, { arg }: { arg: { node_id: string; decision: string; feedback?: string } }) =>
      interactSpecPlan(planId as string, arg)
  )

  const startAndSync = useCallback(async () => {
    if (!planId) return null
    const result = await start.trigger()
    if (result?.status) {
      const statusMap: Record<string, "drafting" | "running" | "waiting" | "completed" | "error"> = {
        running: "running",
        waiting_approval: "waiting",
        completed: "completed",
        failed: "error",
        stalled: "waiting",
      }
      setExecution({ status: statusMap[result.status] ?? "running", progress: 0 })
    }
    return result ?? null
  }, [planId, setExecution, start])

  return useMemo(
    () => ({
      start: startAndSync,
      startState: start,
      interact,
    }),
    [interact, start, startAndSync]
  )
}

export function useSpecPlanNodeUpdate(planId: string | null) {
  const { applyNodeModelOverride } = useSpecAgentStore()

  const mutation = useSWRMutation(
    planId ? `${SPEC_PLAN_DETAIL_KEY}/${planId}/nodes` : null,
    (_key, { arg }: { arg: { nodeId: string; modelOverride: string | null } }) =>
      updateSpecPlanNode(planId as string, arg.nodeId, {
        model_override: arg.modelOverride,
      })
  )

  const update = useCallback(
    async (nodeId: string, modelOverride: string | null) => {
      if (!planId) return null
      const result = (await mutation.trigger({
        nodeId,
        modelOverride,
      })) as SpecPlanNodeUpdateResponse | undefined
      if (result) {
        applyNodeModelOverride(nodeId, result.model_override ?? null)
      }
      return result ?? null
    },
    [applyNodeModelOverride, mutation, planId]
  )

  return useMemo(
    () => ({
      update,
      updateState: mutation,
    }),
    [mutation, update]
  )
}
