import { useCallback, useEffect, useMemo, useRef } from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import useSWRMutation from "swr/mutation"

import {
  createSpecDraft,
  fetchSpecPlanDetail,
  fetchSpecPlanStatus,
  interactSpecPlan,
  startSpecPlan,
  streamSpecDraft,
  updateSpecPlanNode,
  fetchSpecPlanNodeDetail,
  rerunSpecPlanNode,
  appendSpecPlanNodeEvent,
  type SpecDraftRequest,
  type SpecPlanDetail,
  type SpecPlanListItem,
  type SpecPlanListResponse,
  type SpecPlanStatus,
  type SpecPlanNodeDetail,
  type SpecPlanNodeUpdateResponse,
} from "@/lib/api/spec-agent"
import { useSpecAgentStore } from "@/store/spec-agent-store"
import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"

const SPEC_PLAN_DETAIL_KEY = "/api/v1/spec-agent/plans/detail"
const SPEC_PLAN_STATUS_KEY = "/api/v1/spec-agent/plans/status"
const SPEC_PLAN_LIST_KEY = "/api/v1/spec-agent/plans"
const SPEC_PLAN_NODE_DETAIL_KEY = "/api/v1/spec-agent/plans/node-detail"
const SPEC_PLAN_NODE_RERUN_KEY = "/api/v1/spec-agent/plans/node-rerun"

export function useSpecDraftStream(
  options: {
    onPlanInit?: (data: {
      plan_id: string
      project_name?: string
      conversation_session_id?: string | null
    }) => void
  } = {}
) {
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
                setPlanInit(
                  event.data.plan_id,
                  event.data.project_name ?? null,
                  event.data.conversation_session_id ?? null
                )
                options.onPlanInit?.(event.data)
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
                      conversationSessionId: detail.conversation_session_id ?? null,
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
      conversationSessionId: swr.data.conversation_session_id ?? null,
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
  const { applyNodeModelOverride, applyNodeInstructionUpdate, applyNodePendingInstruction } =
    useSpecAgentStore()

  const mutation = useSWRMutation(
    planId ? `${SPEC_PLAN_DETAIL_KEY}/${planId}/nodes` : null,
    (
      _key,
      {
        arg,
      }: {
        arg: {
          nodeId: string
          modelOverride?: string | null
          instruction?: string | null
        }
      }
    ) => {
      const payload: Record<string, string | null> = {}
      if ("modelOverride" in arg) {
        payload.model_override = arg.modelOverride ?? null
      }
      if ("instruction" in arg) {
        payload.instruction = arg.instruction ?? null
      }
      return updateSpecPlanNode(planId as string, arg.nodeId, payload)
    }
  )

  const update = useCallback(
    async (
      nodeId: string,
      payload: { modelOverride?: string | null; instruction?: string | null }
    ) => {
      if (!planId) return null
      const result = (await mutation.trigger({
        nodeId,
        ...(payload.modelOverride !== undefined && {
          modelOverride: payload.modelOverride,
        }),
        ...(payload.instruction !== undefined && { instruction: payload.instruction }),
      })) as SpecPlanNodeUpdateResponse | undefined
      if (result) {
        if (typeof result.model_override !== "undefined") {
          applyNodeModelOverride(nodeId, result.model_override ?? null)
        }
        if (typeof result.instruction === "string") {
          applyNodeInstructionUpdate(nodeId, result.instruction)
        }
        if (typeof result.pending_instruction !== "undefined") {
          applyNodePendingInstruction(nodeId, result.pending_instruction ?? null)
        }
      }
      return result ?? null
    },
    [
      applyNodeInstructionUpdate,
      applyNodeModelOverride,
      applyNodePendingInstruction,
      mutation,
      planId,
    ]
  )

  return useMemo(
    () => ({
      update,
      updateState: mutation,
    }),
    [mutation, update]
  )
}

export function useSpecPlanNodeDetail(
  planId: string | null,
  nodeId: string | null,
  options: { enabled?: boolean } = {}
) {
  const enabled = options.enabled !== false && !!planId && !!nodeId
  const key = enabled ? [SPEC_PLAN_NODE_DETAIL_KEY, planId, nodeId] : null
  return useSWR<SpecPlanNodeDetail, ApiError>(
    key,
    () => fetchSpecPlanNodeDetail(planId as string, nodeId as string),
    { revalidateOnFocus: false }
  )
}

export function useSpecPlanNodeRerun(planId: string | null) {
  const {
    applyNodeInstructionUpdate,
    applyNodePendingInstruction,
    setFocusNodeId,
    setHighlightNodeId,
  } = useSpecAgentStore()
  const mutation = useSWRMutation(
    planId ? `${SPEC_PLAN_NODE_RERUN_KEY}/${planId}` : null,
    (_key, { arg }: { arg: { nodeId: string } }) =>
      rerunSpecPlanNode(planId as string, arg.nodeId)
  )

  const rerun = useCallback(
    async (nodeId: string) => {
      if (!planId) return null
      const result = (await mutation.trigger({ nodeId })) ?? null
      const current = useSpecAgentStore.getState().nodes.find(
        (node) => node.id === nodeId
      )
      if (current?.pendingInstruction) {
        applyNodeInstructionUpdate(nodeId, current.pendingInstruction)
        applyNodePendingInstruction(nodeId, null)
      }
      setFocusNodeId(nodeId)
      setHighlightNodeId(nodeId)
      return result
    },
    [
      applyNodeInstructionUpdate,
      applyNodePendingInstruction,
      mutation,
      planId,
      setFocusNodeId,
      setHighlightNodeId,
    ]
  )

  return useMemo(
    () => ({
      rerun,
      rerunState: mutation,
    }),
    [mutation, rerun]
  )
}

export function useSpecPlanNodeEvent(planId: string | null) {
  const mutation = useSWRMutation(
    planId ? `/spec-agent/${planId}/node-event` : null,
    (_key, { arg }: { arg: { nodeId: string; event: string; source: string } }) =>
      appendSpecPlanNodeEvent(planId as string, arg.nodeId, {
        event: arg.event,
        source: arg.source,
      })
  )

  const send = useCallback(
    async (nodeId: string, event: string, source: string) => {
      if (!planId) return null
      return (await mutation.trigger({ nodeId, event, source })) ?? null
    },
    [mutation, planId]
  )

  return useMemo(
    () => ({
      send,
      eventState: mutation,
    }),
    [mutation, send]
  )
}

export function useSpecPlanHistory(options: { enabled?: boolean; size?: number; status?: string } = {}) {
  const pageSize = options.size ?? 20

  const getKey = useCallback(
    (pageIndex: number, previousPageData: SpecPlanListResponse | null) => {
      if (options.enabled === false) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor = pageIndex === 0 ? null : previousPageData?.next_page
      return [
        SPEC_PLAN_LIST_KEY,
        {
          params: {
            cursor,
            size: pageSize,
            status: options.status ?? undefined,
          },
        },
      ]
    },
    [options.enabled, options.status, pageSize]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<SpecPlanListResponse, ApiError>(getKey, swrFetcher, {
    revalidateOnFocus: false,
  })

  const items = useMemo<SpecPlanListItem[]>(() => {
    if (!data) return []
    return data.flatMap((page) => page.items || [])
  }, [data])

  const hasMore = useMemo(() => {
    if (!data || data.length === 0) return false
    return Boolean(data[data.length - 1]?.next_page)
  }, [data])

  const isLoadingMore =
    isLoading || (size > 0 && !!data && typeof data[size - 1] === "undefined")

  const loadMore = useCallback(() => {
    if (hasMore) {
      setSize(size + 1)
    }
  }, [hasMore, setSize, size])

  const refresh = useCallback(() => {
    void mutate()
  }, [mutate])

  return {
    items,
    error,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
  }
}
