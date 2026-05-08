"use client"

import * as React from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { Separator } from "@/ui/shadcn/separator"
import { useI18n } from "@/hooks/use-i18n"
import { useLlmWikiCandidatePreview } from "@/hooks/use-llm-wiki-candidate-preview"
import {
  commitLocalLlmWikiCandidate,
} from "@/lib/api/llm-wiki"
import { cn } from "@/lib/utils"
import { useChatStore, type Message } from "@/store/chat-store"

interface WikiCrystallizationCardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: Message
  content: string
  disabled?: boolean
}

interface WikiReceipt {
  targetRelativePath: string
  sourceCount: number
}

const MAX_SUMMARY_LENGTH = 220
const MAX_MARKDOWN_PREVIEW_LENGTH = 1400

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function trimTo(value: string, maxLength: number) {
  const normalized = compactWhitespace(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function deriveCandidateTitle(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line))
  if (heading) {
    return trimTo(heading.replace(/^#{1,3}\s+/, ""), 72)
  }
  const firstSentence = compactWhitespace(content).split(/(?<=[.!?。！？])\s+/)[0]
  return trimTo(firstSentence || content, 72) || "Assistant answer"
}

function getVisibleMarkdownPreview(markdown: string) {
  const withoutMetadata = markdown.split(/\n## Metadata\n/)[0] ?? markdown
  return withoutMetadata.length <= MAX_MARKDOWN_PREVIEW_LENGTH
    ? withoutMetadata
    : `${withoutMetadata.slice(0, MAX_MARKDOWN_PREVIEW_LENGTH).trimEnd()}\n…`
}

function getMetadataSubset(message: Message, sessionId: string | null) {
  const meta = message.metaInfo as Record<string, unknown> | undefined
  return {
    messageId: message.id,
    sessionId,
    knowledgeContextStatus: meta?.knowledge_context_status ?? null,
    runtimeMetrics: meta?.runtime_metrics ?? null,
    providerModelId: meta?.provider_model_id ?? meta?.model_id ?? null,
  }
}

function getMemoryImpactLabel(t: ReturnType<typeof useI18n>, value: string) {
  if (value === "none") return t("wikiCrystallization.memoryImpact.none")
  return value
}

function getChangeKindLabel(t: ReturnType<typeof useI18n>, value: string) {
  if (value === "create") return t("wikiCrystallization.changeKind.create")
  if (value === "update") return t("wikiCrystallization.changeKind.update")
  return value
}

export function WikiCrystallizationCard({
  open,
  onOpenChange,
  message,
  content,
  disabled = false,
}: WikiCrystallizationCardProps) {
  const t = useI18n("chat")
  const sessionId = useChatStore((state) => state.sessionId)
  const [receipt, setReceipt] = React.useState<WikiReceipt | null>(null)
  const [isCommitting, setIsCommitting] = React.useState(false)

  const candidatePayload = React.useMemo(() => {
    const title = deriveCandidateTitle(content)
    return {
      sourceKind: "chat_answer",
      title,
      content: content.trim(),
      summary: trimTo(content, MAX_SUMMARY_LENGTH),
      sourceReferences: [
        {
          sourceType: "conversation_message",
          sourceId: message.id,
          title: t("wikiCrystallization.source.assistantAnswer"),
          metadata: {
            role: message.role,
            sessionId,
          },
        },
      ],
      metadata: getMetadataSubset(message, sessionId),
    }
  }, [content, message, sessionId, t])

  const {
    preview,
    isPreviewing,
    errorMessage,
    setErrorMessage,
    resetPreview,
  } = useLlmWikiCandidatePreview({
    open,
    canPreview: Boolean(candidatePayload.content),
    payload: candidatePayload,
    desktopOnlyMessage: t("wikiCrystallization.toast.desktopOnly"),
    unavailableMessage: t("wikiCrystallization.empty"),
    previewFailedMessage: t("wikiCrystallization.toast.previewFailed"),
  })

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setErrorMessage(null)
      }
    },
    [onOpenChange]
  )

  const handleRetryPreview = React.useCallback(() => {
    resetPreview()
    onOpenChange(true)
  }, [onOpenChange, resetPreview])

  const handleCommit = React.useCallback(async () => {
    if (!preview || disabled || isCommitting) return
    setIsCommitting(true)
    setErrorMessage(null)
    try {
      const result = await commitLocalLlmWikiCandidate({ preview })
      const sourceCount = preview.sourceReferences.length
      setReceipt({
        targetRelativePath: result.targetRelativePath,
        sourceCount,
      })
      toast.success(
        t("wikiCrystallization.toast.committed", {
          path: result.targetRelativePath,
        })
      )
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("wikiCrystallization.toast.commitFailed")
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsCommitting(false)
    }
  }, [disabled, isCommitting, onOpenChange, preview, t])

  const markdownPreview = preview ? getVisibleMarkdownPreview(preview.proposedMarkdown) : ""

  return (
    <>
      {receipt ? (
        <div className="mt-2 ml-1 flex max-w-full items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{t("wikiCrystallization.receipt.saved")}</span>
          <code className="min-w-0 truncate rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-foreground">
            {receipt.targetRelativePath}
          </code>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {t("wikiCrystallization.receipt.sources", { count: receipt.sourceCount })}
          </span>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <DialogTitle>{t("wikiCrystallization.title")}</DialogTitle>
            <DialogDescription>{t("wikiCrystallization.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            {isPreviewing ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("wikiCrystallization.loading")}
              </div>
            ) : preview ? (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_1.15fr]">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("wikiCrystallization.fields.title")}
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                      {preview.suggestedTitle}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("wikiCrystallization.fields.path")}
                    </div>
                    <code className="block truncate rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      {preview.targetRelativePath}
                    </code>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t("wikiCrystallization.fields.memoryImpact", {
                      value: getMemoryImpactLabel(t, preview.memoryImpact),
                    })}
                  </Badge>
                  {preview.changedFiles.map((file) => (
                    <Badge key={`${file.changeKind}:${file.relativePath}`} variant="outline">
                      {getChangeKindLabel(t, file.changeKind)} · {file.relativePath}
                    </Badge>
                  ))}
                </div>

                {preview.validationFlags.length ? (
                  <div className="space-y-2 rounded-md border border-amber-500/20 bg-amber-500/8 p-3 text-xs">
                    {preview.validationFlags.map((flag) => (
                      <div key={`${flag.code}:${flag.message}`} className="flex gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 rounded-sm px-1.5 text-[10px] uppercase",
                            flag.severity === "warning" && "border-amber-500/40 text-amber-700 dark:text-amber-200"
                          )}
                        >
                          {flag.severity}
                        </Badge>
                        <span className="text-muted-foreground">{flag.message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("wikiCrystallization.fields.sources")}
                    </div>
                    <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
                      {preview.sourceReferences.map((source, index) => (
                        <div key={`${source.sourceType}:${source.sourceId ?? index}`} className="min-w-0">
                          <div className="font-medium">{source.title ?? source.sourceType}</div>
                          <div className="truncate text-muted-foreground">
                            {source.sourceId ?? source.path ?? source.sourceType}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("wikiCrystallization.fields.markdownPreview")}
                    </div>
                    <ScrollArea className="h-44 rounded-md border bg-muted/20">
                      <pre className="whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-foreground/85">
                        {markdownPreview}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              </>
            ) : (
              <div className="min-h-32 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {errorMessage ?? t("wikiCrystallization.toast.previewFailed")}
              </div>
            )}
          </div>

          <Separator />
          <DialogFooter className="gap-2 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("wikiCrystallization.actions.cancel")}
            </Button>
            {preview ? (
              <Button
                type="button"
                onClick={handleCommit}
                disabled={!preview.canCommit || disabled || isCommitting}
              >
                {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isCommitting
                  ? t("wikiCrystallization.actions.committing")
                  : t("wikiCrystallization.actions.commit")}
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={handleRetryPreview} disabled={isPreviewing}>
                {t("wikiCrystallization.actions.retry")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}


