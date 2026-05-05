"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { getConversationExecutionTree } from "@/lib/api/conversations"
import {
  asActionList,
  asExecutionLifecyclePayload,
  buildExecutionLifecyclePayloadFromPersistedTree,
  getExecutionLifecycleAvailableActions,
  getExecutionLifecycleKind,
  getExecutionLifecyclePrimaryOutput,
  getExecutionLifecycleStatus,
  getExecutionLifecycleSummary,
  toText,
  type ExecutionLifecyclePayload,
} from "@/lib/execution-tree/types"
import { useExecutionActionDispatcher } from "@/lib/execution-tree/actions"
import { cn } from "@/lib/utils"
import type { NativeViewProps } from "./registry"

const toneClassByStatus: Record<string, string> = {
  selected: "bg-slate-100 text-slate-700 border-slate-200",
  launching: "bg-amber-50 text-amber-700 border-amber-200",
  running: "bg-blue-50 text-blue-700 border-blue-200",
  succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-zinc-100 text-zinc-700 border-zinc-200",
  integrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

export default function ExecutionLifecycleView({ data }: NativeViewProps) {
  const basePayload = asExecutionLifecyclePayload(data)
  const rootExecutionId = toText(basePayload.root_execution_id)
  const [hydratedPayload, setHydratedPayload] = useState<{
    rootExecutionId: string
    payload: ExecutionLifecyclePayload
  } | null>(null)

  const payload =
    hydratedPayload?.rootExecutionId === rootExecutionId ? hydratedPayload.payload : basePayload

  useEffect(() => {
    const isTauriRuntime =
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

    if (!isTauriRuntime || !rootExecutionId || basePayload.persisted_snapshot === true) return

    let cancelled = false
    void getConversationExecutionTree(rootExecutionId)
      .then((tree) => {
        if (cancelled) return
        setHydratedPayload({
          rootExecutionId,
          payload: buildExecutionLifecyclePayloadFromPersistedTree(tree),
        })
      })
      .catch(() => {
        if (cancelled) return
        setHydratedPayload((current) =>
          current?.rootExecutionId === rootExecutionId ? null : current
        )
      })

    return () => {
      cancelled = true
    }
  }, [basePayload.persisted_snapshot, rootExecutionId])

  const status = getExecutionLifecycleStatus(payload) ?? "unknown"
  const terminalStatus = toText(payload.terminal_status)
  const executionKind = getExecutionLifecycleKind(payload)
  const summary = getExecutionLifecycleSummary(payload)
  const error = toText(payload.error)
  const availableActions = asActionList(getExecutionLifecycleAvailableActions(payload))
  const hasResult = Boolean(getExecutionLifecyclePrimaryOutput(payload))
  const { dispatchAction } = useExecutionActionDispatcher(payload)

  const showWorkflowOpen = availableActions.some((action) => toText(action?.kind) === "open")
  const showResultOpen =
    hasResult || availableActions.some((action) => toText(action?.kind) === "view_result")

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "border font-medium capitalize",
            toneClassByStatus[status] ?? toneClassByStatus.selected
          )}
        >
          {status}
        </Badge>
        {terminalStatus && terminalStatus !== status ? (
          <Badge variant="outline" className="border-zinc-200 text-zinc-600">
            terminal: {terminalStatus}
          </Badge>
        ) : null}
        {executionKind ? (
          <Badge variant="outline" className="border-zinc-200 text-zinc-600">
            {executionKind}
          </Badge>
        ) : null}
      </div>

      {summary ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-foreground">
          {summary}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {error}
        </div>
      ) : null}

      {(showWorkflowOpen || showResultOpen) ? (
        <div className="flex flex-wrap gap-2">
          {showWorkflowOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void dispatchAction({ kind: "open" })}
            >
              Open workflow
            </Button>
          ) : null}
          {showResultOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void dispatchAction({ kind: "view_result" })}
            >
              View result
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
