"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  FolderOpen,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { Button } from "@/ui/shadcn/button"
import { Badge } from "@/ui/shadcn/badge"
import {
  exportWorkflowArtifact,
  getWorkflowArtifactContent,
  openWorkflowArtifact,
  rerunPhase,
  resumeWorkflow,
} from "@/lib/workflow/commands"
import type { WorkflowResultPayload, WorkflowArtifactSummary } from "@/lib/workflow/presentation"
import type { WorkflowArtifactContent } from "@/lib/workflow/types"
import { useWorkspaceStore } from "@/store/workspace-store"
import { cn } from "@/lib/utils"
import type { NativeViewProps } from "./registry"

function toPayload(data: unknown): WorkflowResultPayload | null {
  if (!data || typeof data !== "object") return null
  return data as WorkflowResultPayload
}

type ArtifactLoadState = {
  runId: string
  loading: boolean
  content: WorkflowArtifactContent | null
  error: string | null
}

export default function WorkflowResultView({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const openView = useWorkspaceStore((state) => state.openView)
  const [showSteps, setShowSteps] = useState(false)

  if (!payload) {
    return <div className="text-sm text-muted-foreground">Invalid workflow result payload.</div>
  }

  const isFailure = payload.status === "failed" || payload.status === "cancelled"
  const statusLabel =
    payload.status === "completed"
      ? "Completed"
      : payload.status === "awaiting_plan_edit"
        ? "Needs review"
        : "Needs recovery"

  const openWorkflow = (phaseId?: string | null, contextPhaseId?: string | null) => {
    openView({
      id: `workflow-${payload.run_id}`,
      type: "native-canvas",
      title: "Workflow",
      keepAlive: true,
      content: {
        viewType: "workflow",
        runId: payload.run_id,
        phaseId: phaseId ?? undefined,
        contextPhaseId: contextPhaseId ?? undefined,
      },
    })
  }

  const rerunFocusedPhase = async () => {
    if (!payload.focus_phase_id) return
    try {
      await rerunPhase({ run_id: payload.run_id, phase_id: payload.focus_phase_id })
      openWorkflow(payload.focus_phase_id)
      toast.success(`Phase ${payload.focus_phase_id} queued for rerun`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const resumePausedWorkflow = async () => {
    try {
      await resumeWorkflow(payload.run_id)
      openWorkflow(payload.focus_phase_id)
      toast.success("Workflow execution resumed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="space-y-5">
      <div className={cn(
        "rounded-lg border p-4",
        isFailure ? "border-rose-200 bg-rose-50/70" : "border-emerald-200 bg-emerald-50/70"
      )}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isFailure ? (
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              <Badge variant="outline" className={cn(
                "capitalize",
                isFailure ? "border-rose-200 text-rose-700" : "border-emerald-200 text-emerald-700"
              )}>
                {statusLabel}
              </Badge>
            </div>
            <h3 className="mt-3 text-base font-semibold tracking-tight text-foreground">{payload.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{payload.goal}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {isFailure && payload.focus_phase_id ? (
              <Button size="sm" variant="outline" onClick={() => void rerunFocusedPhase()}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                重新执行
              </Button>
            ) : null}
            {payload.status === "awaiting_plan_edit" ? (
              <Button size="sm" variant="outline" onClick={() => void resumePausedWorkflow()}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                继续执行
              </Button>
            ) : null}
          </div>
        </div>

        {isFailure ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-white/70 px-3 py-2 text-sm text-rose-700">
            {payload.error || "Workflow stopped before producing a final result."}
            <div className="mt-1 text-xs text-rose-600/80">
              {payload.preserved_success_count} completed phase(s) are preserved and can be reused.
            </div>
          </div>
        ) : payload.summary ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-white/70 p-3">
            <MarkdownViewer content={payload.summary} className="chat-markdown chat-markdown-assistant text-sm leading-relaxed" />
          </div>
        ) : null}
      </div>

      <ArtifactSection runId={payload.run_id} artifacts={payload.artifacts} />

      {/* Collapsible step list */}
      <div className="rounded-lg border border-border/70 bg-background overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/30 transition-colors"
          onClick={() => setShowSteps(!showSteps)}
        >
          {showSteps ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>
            {payload.steps.filter((s) => s.status === "succeeded").length}/{payload.steps.length} 步骤完成
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/60 normal-case tracking-normal">
            {showSteps ? "收起" : "展开详情"}
          </span>
        </button>
        {showSteps && (
          <div className="divide-y divide-border/60 border-t border-border/70">
            {payload.steps.map((step) => (
              <div key={step.phase_id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {step.status === "succeeded" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : step.status === "failed" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                    )}
                    <span className="text-sm font-medium">{step.title}</span>
                  </div>
                  {step.summary ? <p className="mt-1 ml-5.5 line-clamp-2 text-xs text-muted-foreground">{step.summary}</p> : null}
                  {step.error ? <p className="mt-1 ml-5.5 text-xs text-rose-600">{step.error}</p> : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => openWorkflow(step.phase_id, step.phase_id)}
                >
                  查看
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Secondary actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => openWorkflow(payload.focus_phase_id)}>
          <FolderOpen className="mr-1.5 h-3 w-3" />
          打开 Workflow
        </Button>
      </div>
    </div>
  )
}

function ArtifactSection({
  runId,
  artifacts,
}: {
  runId: string
  artifacts: WorkflowArtifactSummary[]
}) {
  const [artifactState, setArtifactState] = useState<Record<string, ArtifactLoadState>>({})

  useEffect(() => {
    let cancelled = false
    if (artifacts.length === 0) return

    for (const artifact of artifacts) {
      void getWorkflowArtifactContent(runId, artifact.ref)
        .then((content) => {
          if (cancelled) return
          setArtifactState((current) => ({
            ...current,
            [artifact.ref]: { runId, loading: false, content, error: null },
          }))
        })
        .catch((error) => {
          if (cancelled) return
          setArtifactState((current) => ({
            ...current,
            [artifact.ref]: {
              runId,
              loading: false,
              content: null,
              error: error instanceof Error ? error.message : String(error),
            },
          }))
        })
    }

    return () => {
      cancelled = true
    }
  }, [artifacts, runId])

  if (artifacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        No explicit artifacts were reported. The summary above is the primary output.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {artifacts.map((artifact) => {
        const loadedState = artifactState[artifact.ref]
        const state =
          loadedState?.runId === runId
            ? loadedState
            : { runId, loading: true, content: null, error: null }
        return (
          <ArtifactCard
            key={artifact.ref}
            runId={runId}
            artifact={artifact}
            state={state}
          />
        )
      })}
    </div>
  )
}

function ArtifactCard({
  runId,
  artifact,
  state,
}: {
  runId: string
  artifact: WorkflowArtifactSummary
  state: ArtifactLoadState
}) {
  const content = state.content
  const kind = content?.kind ?? artifact.kind
  const Icon = kind === "json" ? FileJson : FileText
  const title = content?.file_name ?? artifact.label

  const handleOpen = async () => {
    try {
      await openWorkflowArtifact(runId, artifact.ref)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const handleExport = async () => {
    try {
      const result = await exportWorkflowArtifact(runId, artifact.ref)
      if (result.exported) {
        toast.success("Artifact exported")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className="text-[11px] text-muted-foreground">
              {content ? formatArtifactMeta(content) : "Loading artifact content..."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-5 rounded-[4px] px-1.5 font-mono text-[10px] uppercase">
            {kind}
          </Badge>
          {content?.can_open ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void handleOpen()}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Open
            </Button>
          ) : null}
          {content?.can_export ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void handleExport()}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Export
            </Button>
          ) : null}
        </div>
      </div>
      <ArtifactPreview state={state} />
    </div>
  )
}

function ArtifactPreview({ state }: { state: ArtifactLoadState }) {
  const [expanded, setExpanded] = useState(false)

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载内容...
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="border-t border-rose-100 bg-rose-50/60 px-4 py-3 text-sm text-rose-700">
        {state.error}
      </div>
    )
  }

  const content = state.content
  if (!content) return null

  // Markdown preview: show first N lines with fade
  if (content.kind === "markdown" && content.content) {
    const lines = content.content.split("\n")
    const PREVIEW_LINES = 15
    const needsTruncation = lines.length > PREVIEW_LINES && !expanded
    const displayContent = needsTruncation
      ? lines.slice(0, PREVIEW_LINES).join("\n")
      : content.content

    return (
      <div className="relative">
        <div className={cn("p-4", !expanded && needsTruncation && "max-h-[320px] overflow-hidden")}>
          <MarkdownViewer content={displayContent} className="chat-markdown chat-markdown-assistant text-sm leading-relaxed" />
        </div>
        {needsTruncation && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-16 bg-gradient-to-t from-background to-transparent" />
            <div className="bg-background px-4 pb-3 pt-1">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                onClick={() => setExpanded(true)}
              >
                阅读全文 →
              </button>
            </div>
          </div>
        )}
        {expanded && lines.length > PREVIEW_LINES && (
          <div className="px-4 pb-3">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded(false)}
            >
              ← 收起
            </button>
          </div>
        )}
      </div>
    )
  }

  // JSON preview: show first N lines with syntax highlight
  if (content.kind === "json") {
    const jsonString = JSON.stringify(content.json ?? parseJsonFallback(content.content), null, 2)
    const lines = jsonString.split("\n")
    const PREVIEW_LINES = 12
    const needsTruncation = lines.length > PREVIEW_LINES && !expanded
    const displayContent = needsTruncation
      ? lines.slice(0, PREVIEW_LINES).join("\n") + "\n  ..."
      : jsonString

    return (
      <div className="relative">
        <pre className={cn(
          "bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 overflow-auto",
          !expanded && needsTruncation && "max-h-[240px]"
        )}>
          {displayContent}
        </pre>
        {needsTruncation && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-12 bg-gradient-to-t from-slate-950 to-transparent" />
            <div className="bg-slate-950 px-4 pb-3 pt-1">
              <button
                type="button"
                className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                onClick={() => setExpanded(true)}
              >
                展开全部 ({lines.length} 行) →
              </button>
            </div>
          </div>
        )}
        {expanded && lines.length > PREVIEW_LINES && (
          <div className="bg-slate-950 px-4 pb-3">
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              onClick={() => setExpanded(false)}
            >
              ← 收起
            </button>
          </div>
        )}
      </div>
    )
  }

  // Text preview: same truncation logic
  if (content.kind === "text" && content.content) {
    const lines = content.content.split("\n")
    const PREVIEW_LINES = 15
    const needsTruncation = lines.length > PREVIEW_LINES && !expanded
    const displayContent = needsTruncation
      ? lines.slice(0, PREVIEW_LINES).join("\n")
      : content.content

    return (
      <div className="relative">
        <pre className={cn(
          "whitespace-pre-wrap p-4 text-xs leading-relaxed text-foreground",
          !expanded && needsTruncation && "max-h-[320px] overflow-hidden"
        )}>
          {displayContent}
        </pre>
        {needsTruncation && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-16 bg-gradient-to-t from-background to-transparent" />
            <div className="bg-background px-4 pb-3 pt-1">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                onClick={() => setExpanded(true)}
              >
                阅读全文 →
              </button>
            </div>
          </div>
        )}
        {expanded && lines.length > PREVIEW_LINES && (
          <div className="px-4 pb-3">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded(false)}
            >
              ← 收起
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-5 text-sm text-muted-foreground">
      文件已就绪，可打开或导出。
    </div>
  )
}

function formatArtifactMeta(content: WorkflowArtifactContent): string {
  const size =
    content.size_bytes < 1024
      ? `${content.size_bytes} B`
      : `${(content.size_bytes / 1024).toFixed(1)} KB`
  return `${content.mime_type} · ${size}`
}

function parseJsonFallback(content: string | null): unknown {
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}
