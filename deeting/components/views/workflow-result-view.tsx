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
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { Button } from "@/ui/shadcn/button"
import { Badge } from "@/ui/shadcn/badge"
import {
  exportWorkflowArtifact,
  getWorkflowArtifactContent,
  openWorkflowArtifact,
} from "@/lib/workflow/commands"
import {
  isUserVisibleWorkflowArtifactRef,
  type WorkflowResultPayload,
  type WorkflowArtifactSummary,
} from "@/lib/workflow/presentation"
import type { WorkflowArtifactContent } from "@/lib/workflow/types"
import { PhaseResultViewer } from "@/components/workflow/phase-context-viewer"
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

type PhaseResultDialogState = {
  open: boolean
  loading: boolean
  phaseId: string
  phaseTitle: string
  artifact: WorkflowArtifactContent | null
}

export default function WorkflowResultView({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const [showSteps, setShowSteps] = useState(false)
  const [showArtifacts, setShowArtifacts] = useState(false)
  const [resultDialog, setResultDialog] = useState<PhaseResultDialogState>({
    open: false,
    loading: false,
    phaseId: "",
    phaseTitle: "",
    artifact: null,
  })

  if (!payload) {
    return <div className="text-sm text-muted-foreground">Invalid workflow result payload.</div>
  }

  const isFailure = payload.status === "failed" || payload.status === "cancelled"
  const needsDecision = payload.status === "awaiting_plan_edit"
  const statusLabel =
    payload.status === "completed"
      ? "已完成"
      : payload.status === "awaiting_plan_edit"
        ? "等待你处理"
        : "需要处理"
  const resultDescription = needsDecision
    ? "当前阶段没有顺利完成。后续介入请通过聊天输入表达。"
    : isFailure
      ? "执行已经停止。已完成的阶段会保留。"
      : "已生成最终阶段结果，下面是本次执行的主要产出。"
  const shouldRenderSummary = Boolean(payload.summary && (isFailure || needsDecision))
  const visibleArtifacts = payload.artifacts.filter((artifact) => isUserVisibleWorkflowArtifactRef(artifact.ref))
  const completedSteps = payload.steps.filter((s) => s.status === "succeeded").length

  const openResultDialog = async (phaseId?: string | null) => {
    const targetPhaseId = phaseId ?? payload.focus_phase_id
    const step = targetPhaseId
      ? payload.steps.find((item) => item.phase_id === targetPhaseId)
      : null
    const phaseTitle = step?.title ?? payload.focus_phase_title ?? payload.title
    const artifactSummary = selectPrimaryArtifact(step?.artifacts ?? visibleArtifacts)

    setResultDialog({
      open: true,
      loading: Boolean(artifactSummary),
      phaseId: targetPhaseId ?? payload.focus_phase_id ?? "",
      phaseTitle,
      artifact: artifactSummary ? null : createSummaryArtifact(payload.run_id, targetPhaseId ?? "result", step?.summary ?? payload.summary),
    })

    if (!artifactSummary) return

    try {
      const artifact = await getWorkflowArtifactContent(payload.run_id, artifactSummary.ref)
      setResultDialog({
        open: true,
        loading: false,
        phaseId: step?.phase_id ?? payload.focus_phase_id ?? "",
        phaseTitle,
        artifact,
      })
    } catch (error) {
      setResultDialog((current) => ({ ...current, loading: false }))
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
    <div className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/[0.88] shadow-[0_18px_45px_-34px_rgba(15,23,42,0.55)] dark:border-white/10 dark:bg-zinc-950/70">
      <div className="border-b border-slate-200/70 px-4 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {isFailure || needsDecision ? (
                <AlertTriangle className={cn("h-4 w-4", needsDecision ? "text-amber-600" : "text-rose-600")} />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
              )}
              <Badge variant="outline" className={cn(
                "h-5 rounded-[6px] px-1.5 font-mono text-[10px] uppercase tracking-wider",
                isFailure
                  ? "border-rose-200 text-rose-700 dark:border-rose-400/30 dark:text-rose-300"
                  : needsDecision
                    ? "border-amber-200 text-amber-800 dark:border-amber-400/30 dark:text-amber-200"
                    : "border-teal-200 text-teal-700 dark:border-teal-400/30 dark:text-teal-200"
              )}>
                {statusLabel}
              </Badge>
            </div>
            <h3 className="mt-2 text-[15px] font-semibold tracking-tight text-foreground">{payload.focus_phase_title ?? payload.title}</h3>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{resultDescription}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {payload.focus_phase_id ? (
              <Button size="sm" variant="outline" className="h-8 rounded-[10px] px-3 text-xs" onClick={() => void openResultDialog(payload.focus_phase_id)}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                查看完整结果
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <ResultMetric label="阶段" value={`${completedSteps}/${payload.steps.length}`} />
          <ResultMetric label="文件" value={`${visibleArtifacts.length}`} />
          <ResultMetric label="焦点" value={payload.focus_phase_id ?? "-"} />
        </div>
      </div>

      <div className="px-4 py-4">
        {isFailure ? (
          <div className="rounded-[12px] border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
            {payload.error || "Workflow stopped before producing a final result."}
            <div className="mt-1 text-xs text-rose-600/80 dark:text-rose-200/70">
              已保留 {payload.preserved_success_count} 个完成阶段，可继续复用。
            </div>
          </div>
        ) : visibleArtifacts.length > 0 ? (
          <PrimaryResultPreview runId={payload.run_id} artifacts={visibleArtifacts} summary={payload.summary} />
        ) : payload.summary ? (
          <div className="rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <MarkdownViewer content={payload.summary} className="chat-markdown chat-markdown-assistant text-sm leading-relaxed" />
          </div>
        ) : shouldRenderSummary ? (
          <div className="rounded-[14px] border border-slate-200/80 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <MarkdownViewer content={payload.summary ?? ""} className="chat-markdown chat-markdown-assistant text-sm leading-relaxed" />
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200/70 dark:border-white/10">
        {showArtifacts && visibleArtifacts.length > 0 ? (
          <div className="border-b border-slate-200/70 px-4 py-4 dark:border-white/10">
            <ArtifactSection runId={payload.run_id} artifacts={visibleArtifacts} />
          </div>
        ) : visibleArtifacts.length > 0 ? (
          <button
            type="button"
            className="flex w-full items-center justify-between border-b border-slate-200/70 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50/70 dark:border-white/10 dark:hover:bg-white/[0.04]"
            onClick={() => setShowArtifacts(true)}
          >
            <span className="font-medium">查看执行文件</span>
            <span className="text-xs text-muted-foreground">{visibleArtifacts.length} 个文件</span>
          </button>
        ) : null}

        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-slate-50/70 transition-colors dark:hover:bg-white/[0.04]"
          onClick={() => setShowSteps(!showSteps)}
        >
          {showSteps ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>
            {completedSteps}/{payload.steps.length} 步骤完成
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/60 normal-case tracking-normal">
            {showSteps ? "收起" : "展开详情"}
          </span>
        </button>
        {showSteps && (
          <div className="divide-y divide-slate-200/70 border-t border-slate-200/70 dark:divide-white/10 dark:border-white/10">
            {payload.steps.map((step) => (
              <div key={step.phase_id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {step.status === "succeeded" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : step.status === "failed" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                      )}
                      <span className="truncate text-sm font-medium">{step.title}</span>
                    </div>
                    {step.summary ? <p className="mt-1 ml-5.5 line-clamp-2 text-xs text-muted-foreground">{step.summary}</p> : null}
                    {step.error ? <p className="mt-1 ml-5.5 text-xs text-rose-600">{step.error}</p> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 rounded-[8px] px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => void openResultDialog(step.phase_id)}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    查看完整
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    <PhaseResultViewer
      open={resultDialog.open}
      onClose={() => setResultDialog((current) => ({ ...current, open: false }))}
      phaseId={resultDialog.phaseId}
      phaseTitle={resultDialog.phaseTitle}
      artifact={resultDialog.artifact}
      loading={resultDialog.loading}
    />
    </>
  )
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-slate-200/70 bg-slate-50/65 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</div>
    </div>
  )
}

function PrimaryResultPreview({
  runId,
  artifacts,
  summary,
}: {
  runId: string
  artifacts: WorkflowArtifactSummary[]
  summary: string | null
}) {
  const selectedArtifact = selectPrimaryArtifact(artifacts)
  const [state, setState] = useState<ArtifactLoadState>({
    runId,
    loading: Boolean(selectedArtifact),
    content: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    if (!selectedArtifact) {
      return
    }

    void getWorkflowArtifactContent(runId, selectedArtifact.ref)
      .then((content) => {
        if (!cancelled) setState({ runId, loading: false, content, error: null })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            runId,
            loading: false,
            content: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [runId, selectedArtifact])

  return (
    <div className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-slate-50/55 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-3 py-2 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-foreground">最终结果</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/70">
            {state.content?.file_name ?? selectedArtifact?.label ?? "summary"}
          </div>
        </div>
        {state.content ? (
          <Badge variant="outline" className="h-5 rounded-[5px] px-1.5 font-mono text-[10px] uppercase">
            {state.content.kind}
          </Badge>
        ) : null}
      </div>
      {selectedArtifact ? (
        <ArtifactPreview state={state} />
      ) : summary ? (
        <div className="p-3">
          <MarkdownViewer content={summary} className="chat-markdown chat-markdown-assistant text-sm leading-relaxed" />
        </div>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">暂无可读结果。</div>
      )}
    </div>
  )
}

function selectPrimaryArtifact(artifacts: WorkflowArtifactSummary[]): WorkflowArtifactSummary | null {
  return (
    artifacts.find((artifact) => artifact.label.toLowerCase() === "result.md") ??
    artifacts.find((artifact) => artifact.kind === "markdown") ??
    artifacts.find((artifact) => artifact.kind !== "json") ??
    artifacts[0] ??
    null
  )
}

function createSummaryArtifact(
  runId: string,
  phaseId: string,
  content: string | null,
): WorkflowArtifactContent | null {
  if (!content?.trim()) return null
  return {
    run_id: runId,
    artifact_ref: `${phaseId}/summary.md`,
    file_name: "result.md",
    kind: "markdown",
    mime_type: "text/markdown",
    content,
    json: null,
    size_bytes: content.length,
    can_preview: true,
    can_open: false,
    can_export: false,
  }
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
  const meta = content
    ? formatArtifactMeta(content)
    : state.error
      ? state.error
      : state.loading
        ? "正在读取文件信息..."
        : "文件已就绪"

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
    <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-border/60 bg-background/70 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className={cn("truncate text-[11px] text-muted-foreground", state.error && "text-rose-600")}>
              {meta}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="h-5 rounded-[4px] border-border/60 px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
            {kind}
          </Badge>
          {content?.can_open ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void handleOpen()}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              打开
            </Button>
          ) : null}
          {content?.can_export ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void handleExport()}>
              <Download className="mr-1 h-3.5 w-3.5" />
              导出
            </Button>
          ) : null}
        </div>
      </div>
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
