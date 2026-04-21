"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  Download,
  Trash2,
  Hash,
  Clock,
  HardDrive,
  Layers,
  AlertCircle,
  Loader2,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/ui/shadcn/sheet"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { StatusPill } from "@/ui/common/status-pill"
import { Badge } from "@/ui/shadcn/badge"
import { GlassButton } from "@/ui/common/glass-button"
import { cn } from "@/lib/utils"
import type { KnowledgeFile, KnowledgeChunk } from "@/types/knowledge"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const STATUS_TONE = {
  active: "success",
  processing: "warn",
  failed: "error",
} as const

interface FileDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: KnowledgeFile | null
  chunks: KnowledgeChunk[]
  isChunksLoading?: boolean
  onDownload?: () => void
  onDelete?: () => void
}

export function FileDetailDrawer({
  open,
  onOpenChange,
  file,
  chunks,
  isChunksLoading = false,
  onDownload,
  onDelete,
}: FileDetailDrawerProps) {
  const t = useTranslations("knowledge")

  const statusText = useMemo(() => {
    if (!file) return ""
    return t(`status.${file.status}`)
  }, [file, t])

  if (!file) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="h-full max-h-screen w-full max-w-[640px] gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-[var(--border)]/60 bg-[var(--surface)]/20 px-6 py-5 text-left">
          <div className="space-y-4 pr-10">
            <div className="space-y-2">
              <SheetTitle className="line-clamp-2 text-xl leading-tight text-[var(--foreground)]">
                {file.name}
              </SheetTitle>
              <SheetDescription asChild className="text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="uppercase tracking-[0.14em] text-[11px]">
                    {file.type}
                  </Badge>
                </div>
              </SheetDescription>
            </div>

            <div className="rounded-2xl border border-[var(--border)]/60 bg-[var(--background)]/85 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  {t("detailDrawer.metadata")}
                </p>
                <StatusPill
                  tone={STATUS_TONE[file.status]}
                  text={statusText}
                  isLoading={file.status === "processing"}
                  size="sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[var(--surface)]/55 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)] text-[var(--muted)]">
                      <HardDrive className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--muted)]">{t("detailDrawer.fileSize")}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                        {formatBytes(file.size)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-[var(--surface)]/55 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)] text-[var(--muted)]">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--muted)]">{t("detailDrawer.uploadTime")}</p>
                      <p className="mt-1 text-sm font-semibold leading-5 text-[var(--foreground)]">
                        {formatDate(file.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-[var(--surface)]/55 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)] text-[var(--muted)]">
                      <Hash className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--muted)]">{t("detailDrawer.status")}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{statusText}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-[var(--surface)]/55 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--background)] text-[var(--muted)]">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--muted)]">{t("detailDrawer.chunkCount")}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                        {file.chunks != null ? file.chunks.toLocaleString() : "--"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-6 py-6">
            <section className="rounded-2xl border border-[var(--border)]/60 bg-[var(--surface)]/25 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <GlassButton
                  variant="secondary"
                  size="sm"
                  onClick={onDownload}
                  className="w-full justify-center"
                >
                  <Download className="mr-1 h-4 w-4" />
                  {t("actions.download")}
                </GlassButton>
                <GlassButton
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  className="w-full justify-center"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {t("actions.delete")}
                </GlassButton>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)]/60 bg-[var(--surface)]/25 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  {t("detailDrawer.chunkPreview")}
                </h3>
                {file.status === "active" && chunks.length > 0 && (
                  <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[10px]">
                    {chunks.length.toLocaleString()}
                  </Badge>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {file.status === "processing" && (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)]/70 bg-[var(--background)]/70 px-4 py-10 text-center text-[var(--muted)]">
                    <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                    <p className="text-sm">{t("detailDrawer.processingHint")}</p>
                  </div>
                )}

                {file.status === "failed" && (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-10 text-center text-red-500 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
                    <AlertCircle className="mb-3 h-6 w-6" />
                    <p className="max-w-sm text-sm leading-6">
                      {t("detailDrawer.failedHint", { error: file.errorMessage ?? "" })}
                    </p>
                  </div>
                )}

                {file.status === "active" && isChunksLoading && (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)]/70 bg-[var(--background)]/70 px-4 py-10 text-center text-[var(--muted)]">
                    <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                    <p className="text-sm">{t("detailDrawer.loadingChunks")}</p>
                  </div>
                )}

                {file.status === "active" && !isChunksLoading && chunks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--border)]/70 bg-[var(--background)]/70 px-4 py-10 text-center">
                    <p className="text-sm text-[var(--muted)]">{t("detailDrawer.noChunks")}</p>
                  </div>
                )}

                {file.status === "active" &&
                  !isChunksLoading &&
                  chunks.map((chunk, idx) => (
                    <div
                      key={chunk.id}
                      className={cn(
                        "space-y-3 rounded-xl border border-[var(--border)]/60 p-4 shadow-sm",
                        idx % 2 === 0
                          ? "bg-[var(--background)]/90"
                          : "bg-[var(--surface)]/45"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="text-[10px]">
                          #{chunk.index}
                        </Badge>
                        <span className="rounded-full bg-[var(--surface)]/80 px-2.5 py-1 text-[10px] text-[var(--muted)]">
                          {chunk.tokenCount} tokens
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">
                        {chunk.content}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
