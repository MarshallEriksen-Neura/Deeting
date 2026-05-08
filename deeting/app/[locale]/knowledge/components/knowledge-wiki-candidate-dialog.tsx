"use client"

import * as React from "react"
import { BookMarked, CheckCircle2, Loader2 } from "lucide-react"
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
import type { KnowledgeChunk, KnowledgeFile } from "@/types/knowledge"

interface KnowledgeWikiCandidateDialogProps {
  file: KnowledgeFile
  chunks: KnowledgeChunk[]
  disabled?: boolean
  isChunksLoading?: boolean
}

interface KnowledgeWikiReceipt {
  targetRelativePath: string
}

const MAX_CHUNKS_FOR_PREVIEW = 8
const MAX_CHUNK_CHARS = 900
const MAX_MARKDOWN_PREVIEW_LENGTH = 1400

function summarizeChunks(chunks: KnowledgeChunk[]) {
  return chunks
    .slice(0, MAX_CHUNKS_FOR_PREVIEW)
    .map((chunk) => {
      const content = chunk.content.trim()
      const trimmed = content.length > MAX_CHUNK_CHARS ? `${content.slice(0, MAX_CHUNK_CHARS).trimEnd()}...` : content
      const section = chunk.sectionPath?.length ? ` (${chunk.sectionPath.join(" / ")})` : ""
      return `### Chunk ${chunk.index}${section}\n\n${trimmed}`
    })
    .join("\n\n")
}

function getCandidateContent(file: KnowledgeFile, chunks: KnowledgeChunk[]) {
  const chunkSummary = summarizeChunks(chunks)
  return [
    `Source file: ${file.name}`,
    `File type: ${file.type}`,
    `Chunk count: ${file.chunks ?? chunks.length}`,
    "",
    "## Representative excerpts",
    "",
    chunkSummary || "No chunk excerpt is available yet.",
  ].join("\n")
}

function getVisibleMarkdownPreview(markdown: string) {
  const withoutMetadata = markdown.split(/\n## Metadata\n/)[0] ?? markdown
  return withoutMetadata.length <= MAX_MARKDOWN_PREVIEW_LENGTH
    ? withoutMetadata
    : `${withoutMetadata.slice(0, MAX_MARKDOWN_PREVIEW_LENGTH).trimEnd()}\n...`
}

function getMemoryImpactLabel(t: ReturnType<typeof useI18n>, value: string) {
  if (value === "none") return t("llmWiki.memoryImpact.none")
  return value
}

function getChangeKindLabel(t: ReturnType<typeof useI18n>, value: string) {
  if (value === "create") return t("llmWiki.changeKind.create")
  if (value === "update") return t("llmWiki.changeKind.update")
  return value
}

export function KnowledgeWikiCandidateDialog({
  file,
  chunks,
  disabled = false,
  isChunksLoading = false,
}: KnowledgeWikiCandidateDialogProps) {
  const t = useI18n("knowledge")
  const [open, setOpen] = React.useState(false)
  const [receipt, setReceipt] = React.useState<KnowledgeWikiReceipt | null>(null)
  const [isCommitting, setIsCommitting] = React.useState(false)

  const canCreate = file.status === "active" && chunks.length > 0 && !disabled && !isChunksLoading

  const payload = React.useMemo(() => {
    const content = getCandidateContent(file, chunks)
    return {
      sourceKind: "knowledge_file",
      title: file.name.replace(/\.[^.]+$/, ""),
      content,
      summary: t("llmWiki.summary", {
        name: file.name,
        count: chunks.length,
      }),
      sourceReferences: [
        {
          sourceType: "local_knowledge_file",
          sourceId: file.id,
          title: file.name,
          metadata: {
            fileType: file.type,
            chunkCount: file.chunks ?? chunks.length,
            status: file.status,
          },
        },
      ],
      metadata: {
        fileId: file.id,
        fileName: file.name,
        fileType: file.type,
        chunkIds: chunks.slice(0, MAX_CHUNKS_FOR_PREVIEW).map((chunk) => chunk.id),
      },
    }
  }, [chunks, file, t])

  const {
    preview,
    isPreviewing,
    errorMessage,
    setErrorMessage,
    resetPreview,
  } = useLlmWikiCandidatePreview({
    open,
    canPreview: canCreate,
    payload,
    desktopOnlyMessage: t("llmWiki.toast.desktopOnly"),
    unavailableMessage: t("llmWiki.unavailable"),
    previewFailedMessage: t("llmWiki.toast.previewFailed"),
  })

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setErrorMessage(null)
  }, [])

  const handleRetryPreview = React.useCallback(() => {
    resetPreview()
    setOpen(true)
  }, [resetPreview])

  const handleCommit = React.useCallback(async () => {
    if (!preview || isCommitting) return
    setIsCommitting(true)
    setErrorMessage(null)
    try {
      const result = await commitLocalLlmWikiCandidate({ preview })
      setReceipt({ targetRelativePath: result.targetRelativePath })
      toast.success(t("llmWiki.toast.committed", { path: result.targetRelativePath }))
      setOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("llmWiki.toast.commitFailed")
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsCommitting(false)
    }
  }, [isCommitting, preview, t])

  const markdownPreview = preview ? getVisibleMarkdownPreview(preview.proposedMarkdown) : ""

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!canCreate}
        className="w-full justify-center"
        title={!canCreate ? t("llmWiki.unavailable") : t("llmWiki.createSourceSummary")}
      >
        <BookMarked className="mr-1 h-4 w-4" />
        {t("llmWiki.createSourceSummary")}
      </Button>
      {receipt ? (
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{t("llmWiki.receipt.saved")}</span>
          <code className="min-w-0 truncate rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-foreground">
            {receipt.targetRelativePath}
          </code>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <DialogTitle>{t("llmWiki.dialog.title")}</DialogTitle>
            <DialogDescription>{t("llmWiki.dialog.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            {isPreviewing ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("llmWiki.dialog.loading")}
              </div>
            ) : preview ? (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_1.15fr]">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("llmWiki.fields.title")}
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                      {preview.suggestedTitle}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("llmWiki.fields.path")}
                    </div>
                    <code className="block truncate rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      {preview.targetRelativePath}
                    </code>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t("llmWiki.fields.memoryImpact", {
                      value: getMemoryImpactLabel(t, preview.memoryImpact),
                    })}
                  </Badge>
                  {preview.changedFiles.map((changedFile) => (
                    <Badge key={`${changedFile.changeKind}:${changedFile.relativePath}`} variant="outline">
                      {getChangeKindLabel(t, changedFile.changeKind)} · {changedFile.relativePath}
                    </Badge>
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("llmWiki.fields.sources")}
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
                      {t("llmWiki.fields.markdownPreview")}
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
                {errorMessage ?? t("llmWiki.toast.previewFailed")}
              </div>
            )}
          </div>

          <Separator />
          <DialogFooter className="gap-2 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("llmWiki.actions.cancel")}
            </Button>
            {preview ? (
              <Button type="button" onClick={handleCommit} disabled={!preview.canCommit || isCommitting}>
                {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isCommitting ? t("llmWiki.actions.committing") : t("llmWiki.actions.commit")}
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={handleRetryPreview} disabled={isPreviewing}>
                {t("llmWiki.actions.retry")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
