"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  Download,
  Share2,
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
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StatusPill } from "@/components/ui/status-pill"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { Separator } from "@/components/ui/separator"
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
  onShare?: () => void
  onDelete?: () => void
}

export function FileDetailDrawer({
  open,
  onOpenChange,
  file,
  chunks,
  isChunksLoading = false,
  onDownload,
  onShare,
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
      <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>{file.name}</SheetTitle>
          <SheetDescription>
            <Badge variant="secondary" className="uppercase">
              {file.type}
            </Badge>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 pr-2">
            {/* Metadata Section */}
            <div className="rounded-xl bg-[var(--surface)]/30 p-4 space-y-3">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                {t("detailDrawer.metadata")}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <HardDrive className="h-3.5 w-3.5" />
                  {t("detailDrawer.fileSize")}
                </div>
                <div className="text-[var(--foreground)]">{formatBytes(file.size)}</div>

                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <Clock className="h-3.5 w-3.5" />
                  {t("detailDrawer.uploadTime")}
                </div>
                <div className="text-[var(--foreground)]">{formatDate(file.createdAt)}</div>

                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <Hash className="h-3.5 w-3.5" />
                  {t("detailDrawer.status")}
                </div>
                <div>
                  <StatusPill
                    tone={STATUS_TONE[file.status]}
                    text={statusText}
                    isLoading={file.status === "processing"}
                    size="sm"
                  />
                </div>

                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <Layers className="h-3.5 w-3.5" />
                  {t("detailDrawer.chunkCount")}
                </div>
                <div className="text-[var(--foreground)] font-medium">
                  {file.chunks != null ? file.chunks.toLocaleString() : "--"}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <GlassButton variant="secondary" size="sm" onClick={onDownload}>
                <Download className="h-4 w-4 mr-1" />
                {t("actions.download")}
              </GlassButton>
              <GlassButton variant="secondary" size="sm" onClick={onShare}>
                <Share2 className="h-4 w-4 mr-1" />
                {t("actions.share")}
              </GlassButton>
              <GlassButton variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-1" />
                {t("actions.delete")}
              </GlassButton>
            </div>

            <Separator />

            {/* Chunk Preview Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
                {t("detailDrawer.chunkPreview")}
                {file.status === "active" && chunks.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {chunks.length}
                  </Badge>
                )}
              </h3>

              {file.status === "processing" && (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--muted)]">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  <p className="text-sm">{t("detailDrawer.processingHint")}</p>
                </div>
              )}

              {file.status === "failed" && (
                <div className="flex flex-col items-center justify-center py-8 text-red-500">
                  <AlertCircle className="h-6 w-6 mb-2" />
                  <p className="text-sm">
                    {t("detailDrawer.failedHint", { error: file.errorMessage ?? "" })}
                  </p>
                </div>
              )}

              {file.status === "active" && isChunksLoading && (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--muted)]">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  <p className="text-sm">{t("detailDrawer.loadingChunks")}</p>
                </div>
              )}

              {file.status === "active" && !isChunksLoading && chunks.length === 0 && (
                <p className="text-sm text-[var(--muted)] text-center py-8">
                  {t("detailDrawer.noChunks")}
                </p>
              )}

              {file.status === "active" &&
                !isChunksLoading &&
                chunks.map((chunk, idx) => (
                  <div
                    key={chunk.id}
                    className={cn(
                      "rounded-lg p-3 space-y-2",
                      idx % 2 === 0 ? "bg-[var(--surface)]/30" : "bg-[var(--surface)]/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px]">
                        #{chunk.index}
                      </Badge>
                      <span className="text-[10px] text-[var(--muted)]">
                        {chunk.tokenCount} tokens
                      </span>
                    </div>
                    <p className="text-xs text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">
                      {chunk.content}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
