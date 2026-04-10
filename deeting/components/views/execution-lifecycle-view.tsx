"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getConversationExecutionTree } from "@/lib/api/conversations"
import {
  asActionList,
  asExecutionLifecyclePayload,
  buildExecutionLifecyclePayloadFromPersistedTree,
  type ExecutionLifecyclePayload,
  getExecutionLifecycleAvailableActions,
  getExecutionLifecycleChildren,
  getExecutionLifecycleError,
  getExecutionLifecycleKind,
  getExecutionLifecycleSelection,
  getExecutionLifecycleSummary,
  getExecutionLifecycleTarget,
  toText,
} from "@/lib/execution-tree/types"
import { useExecutionActionDispatcher } from "@/lib/execution-tree/actions"
import { cn } from "@/lib/utils"

const toneClassByStatus: Record<string, string> = {
  selected: "bg-slate-100 text-slate-700 border-slate-200",
  launching: "bg-amber-50 text-amber-700 border-amber-200",
  running: "bg-blue-50 text-blue-700 border-blue-200",
  succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-zinc-100 text-zinc-700 border-zinc-200",
  integrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

export default function ExecutionLifecycleView({
  data,
}: {
  data: unknown
  title?: string
  metadata?: Record<string, unknown>
}) {
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

  const status = toText(payload.execution_status) ?? "unknown"
  const terminalStatus = toText(payload.terminal_status)
  const target = getExecutionLifecycleTarget(payload)
  const selection = getExecutionLifecycleSelection(payload)
  const targetName = toText(target?.name) ?? "Unknown target"
  const reasonText = toText(selection?.reason_text)
  const summary = getExecutionLifecycleSummary(payload)
  const error = getExecutionLifecycleError(payload)
  const workflowRunId = toText(target?.workflow_run_id)
  const workerRef = toText(target?.worker_ref)
  const invocationKind = toText(target?.invocation_kind)
  const executionKind = getExecutionLifecycleKind(payload)
  const score = typeof selection?.score === "number" ? selection.score : null
  const availableActions = asActionList(getExecutionLifecycleAvailableActions(payload))
  const children = getExecutionLifecycleChildren(payload)
  const { dispatchAction } = useExecutionActionDispatcher(payload)

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

      <div className="space-y-1">
        <div className="font-medium text-foreground">{targetName}</div>
        {reasonText ? <div className="text-muted-foreground">Reason: {reasonText}</div> : null}
        {typeof score === "number" ? (
          <div className="text-muted-foreground">Selection score: {score}</div>
        ) : null}
        {workflowRunId ? (
          <div>
            {availableActions.some((action) => toText(action?.kind) === "open") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => void dispatchAction({ kind: "open" })}
              >
                Open workflow
              </Button>
            ) : null}
          </div>
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

      {children.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Child Executions
          </div>
          <div className="space-y-2">
            {children.map((child, index) => {
              const title = toText(child?.title) ?? `Step ${index + 1}`
              const stepStatus = toText(child?.status) ?? "unknown"
              const phaseId = toText(child?.phase_id)
              const stepType = toText(child?.step_type)
              const childWorkerRef = toText(child?.worker_ref)
              const childSummary = toText(child?.summary)
              const childError = toText(child?.error)
              const childActions = asActionList(child?.available_actions)
              return (
                <div
                  key={`${phaseId ?? title}-${index}`}
                  className="rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{title}</div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "border capitalize",
                          toneClassByStatus[stepStatus] ?? "border-zinc-200 text-zinc-600"
                        )}
                      >
                        {stepStatus}
                      </Badge>
                          {childActions.some(
                            (action) => toText(action?.kind) === "view_result"
                          ) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void dispatchAction({ kind: "view_result" }, child)}
                            >
                              View result
                            </Button>
                          ) : null}
                      {workflowRunId && phaseId ? (
                        <>
                          {childActions.some(
                            (action) => toText(action?.kind) === "open"
                          ) ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void dispatchAction({ kind: "open" }, child)}
                            >
                              Open
                            </Button>
                          ) : null}
                          {childActions.some(
                            (action) => toText(action?.kind) === "rerun"
                          ) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void dispatchAction({ kind: "rerun" }, child)}
                            >
                              Rerun
                            </Button>
                          ) : null}
                          {childActions.some(
                            (action) => toText(action?.kind) === "view_context"
                          ) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void dispatchAction({ kind: "view_context" }, child)}
                            >
                              View context
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                  {phaseId ? (
                    <div className="mt-1 text-xs text-muted-foreground">Phase: {phaseId}</div>
                  ) : null}
                  {stepType ? (
                    <div className="mt-1 text-xs text-muted-foreground">Type: {stepType}</div>
                  ) : null}
                  {childWorkerRef ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Worker: {childWorkerRef}
                    </div>
                  ) : null}
                  {childSummary ? (
                    <div className="mt-2 text-xs text-foreground">{childSummary}</div>
                  ) : null}
                  {childError ? (
                    <div className="mt-2 text-xs text-red-700">{childError}</div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-1 text-xs text-muted-foreground">
        {invocationKind ? <div>Invocation kind: {invocationKind}</div> : null}
        {workerRef ? <div>Worker ref: {workerRef}</div> : null}
        {workflowRunId ? <div>Workflow run: {workflowRunId}</div> : null}
        {toText(payload.execution_id) ? <div>Execution id: {payload.execution_id}</div> : null}
      </div>
    </div>
  )
}
