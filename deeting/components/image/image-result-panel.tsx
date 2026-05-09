"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, Download, Image as ImageIcon, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/ui/shadcn/button"
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from "@/ui/shadcn/dialog"
import { useLazyImage } from "@/hooks/use-lazy-image"
import { useI18n } from "@/hooks/use-i18n"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { copyToClipboard } from "@/lib/utils/copy-to-clipboard"
import { cn } from "@/lib/utils"

export interface ImageResultOutputItem {
  output_index: number
  asset_url?: string | null
  source_url?: string | null
  seed?: number | null
  content_type?: string | null
  size_bytes?: number | null
  width?: number | null
  height?: number | null
}

export interface ImageResultPanelPayload {
  preview?: ImageResultOutputItem | null
  outputs?: ImageResultOutputItem[]
  prompt?: string | null
  model?: string | null
}

interface ImageResultPanelProps {
  payload: ImageResultPanelPayload
  className?: string
}

type ResolvedImageItem = ImageResultOutputItem & {
  originalUrl: string
  resolvedUrl: string
}

const fileExtensionByContentType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

const LazyImage = memo<{
  src: string
  alt: string
  fit?: "natural" | "cover"
}>(({ src, alt, fit = "natural" }) => {
  const { imageSrc, isLoading, error, imgRef } = useLazyImage({
    src,
    rootMargin: "80px",
    threshold: 0.01,
  })

  if (fit === "cover") {
    return (
      <div className="absolute inset-0">
        <img
          ref={imgRef}
          src={imageSrc ?? undefined}
          alt={alt}
          className={cn(
            "h-full w-full object-cover transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
            (isLoading || !imageSrc || error) && "opacity-0 scale-[1.02]"
          )}
        />
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-foreground/30">
            <ImageIcon className="h-5 w-5" />
          </div>
        ) : null}
        {!error && (isLoading || !imageSrc) ? (
          <div className="absolute inset-0 animate-pulse bg-foreground/[0.04]" />
        ) : null}
      </div>
    )
  }

  return (
    <>
      <img
        ref={imgRef}
        src={imageSrc ?? undefined}
        alt={alt}
        className={cn(
          "block h-auto w-full max-h-[70vh] select-none object-contain transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
          (isLoading || !imageSrc || error) && "opacity-0 scale-[1.02]"
        )}
      />
      {(isLoading || !imageSrc) && !error ? (
        <div className="absolute inset-0 animate-pulse bg-foreground/[0.04]" />
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-foreground/30">
          <ImageIcon className="h-5 w-5" />
        </div>
      ) : null}
    </>
  )
})

LazyImage.displayName = "LazyImage"

function normalizeOutputs(payload: ImageResultPanelPayload): ImageResultOutputItem[] {
  const outputs = Array.isArray(payload.outputs) ? payload.outputs.filter(Boolean) : []
  if (outputs.length > 0) return outputs
  if (payload.preview) return [payload.preview]
  return []
}

function getPreferredUrl(item: ImageResultOutputItem): string {
  return item.asset_url?.trim() || item.source_url?.trim() || ""
}

async function resolveImageUrl(item: ImageResultOutputItem): Promise<ResolvedImageItem | null> {
  const originalUrl = getPreferredUrl(item)
  if (!originalUrl) return null

  if (originalUrl.startsWith("local-asset://")) {
    const sha256 = originalUrl.slice("local-asset://".length).replace(/^\/+/, "")
    if (!sha256) return null
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const result = await invoke<{ data_url: string }>("read_local_chat_asset", {
        payload: {
          sha256,
          content_type: item.content_type ?? "image/png",
        },
      })
      return { ...item, originalUrl, resolvedUrl: result.data_url }
    } catch {
      return null
    }
  }

  if (originalUrl.startsWith("asset://")) {
    const objectKey = originalUrl.slice("asset://".length).replace(/^\/+/, "")
    if (!objectKey) return null
    try {
      const ticket = await prepareDesktopObjectStorageRead({
        object_key: objectKey,
        expires_seconds: 900,
      })
      return { ...item, originalUrl, resolvedUrl: ticket.asset_url }
    } catch {
      return null
    }
  }

  return { ...item, originalUrl, resolvedUrl: originalUrl }
}

function imageFilename(item: ImageResultOutputItem, index: number): string {
  const contentType = item.content_type?.trim().toLowerCase() || ""
  const ext = fileExtensionByContentType[contentType] ?? "png"
  return `deeting-image-${index + 1}.${ext}`
}

async function downloadImage(item: ResolvedImageItem, index: number) {
  try {
    const response = await fetch(item.resolvedUrl)
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = blobUrl
    anchor.download = imageFilename(item, index)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    return
  } catch {
    const anchor = document.createElement("a")
    anchor.href = item.resolvedUrl
    anchor.download = imageFilename(item, index)
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
}

async function copyImage(item: ResolvedImageItem): Promise<boolean> {
  const ClipboardItemCtor = typeof ClipboardItem === "undefined" ? null : ClipboardItem
  if (navigator.clipboard?.write && ClipboardItemCtor) {
    try {
      const response = await fetch(item.resolvedUrl)
      if (!response.ok) throw new Error(`Copy failed: ${response.status}`)
      const sourceBlob = await response.blob()
      const contentType = item.content_type?.trim() || sourceBlob.type || "image/png"
      const blob =
        sourceBlob.type === contentType ? sourceBlob : sourceBlob.slice(0, sourceBlob.size, contentType)
      await navigator.clipboard.write([new ClipboardItemCtor({ [contentType]: blob })])
      return true
    } catch {
      // Some desktop WebViews do not expose image clipboard writes.
    }
  }
  return copyToClipboard(item.resolvedUrl)
}

function gridClassFor(count: number) {
  if (count <= 1) return "grid-cols-1"
  if (count === 2) return "grid-cols-1 sm:grid-cols-2"
  if (count <= 4) return "grid-cols-2"
  return "grid-cols-2 lg:grid-cols-3"
}

function tileClassFor(count: number) {
  if (count === 2) return "aspect-square sm:aspect-[4/3]"
  return "aspect-square"
}

const imageActionButtonClass =
  "h-7 w-7 rounded-[7px] border [border-color:rgba(15,17,28,0.08)] bg-[var(--panel-bg)] text-foreground shadow-none hover:bg-foreground/[0.05] dark:[border-color:rgba(255,255,255,0.08)]"

export const ImageResultPanel = memo<ImageResultPanelProps>(function ImageResultPanel({
  payload,
  className,
}) {
  const t = useI18n("chat")
  const outputs = useMemo(() => normalizeOutputs(payload), [payload])
  const [items, setItems] = useState<Array<ResolvedImageItem | null>>([])
  const [isResolving, setIsResolving] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsResolving(outputs.length > 0)
    setItems(outputs.length > 0 ? Array(outputs.length).fill(null) : [])

    void Promise.all(outputs.map(resolveImageUrl)).then((resolved) => {
      if (cancelled) return
      setItems(resolved)
      setIsResolving(false)
    })

    return () => {
      cancelled = true
    }
  }, [outputs])

  const openPreview = useCallback((index: number) => {
    setPreviewIndex(index)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewIndex(null)
  }, [])

  const handleDownload = useCallback(
    async (item: ResolvedImageItem, index: number) => {
      const actionKey = `download-${index}`
      setBusyAction(actionKey)
      try {
        await downloadImage(item, index)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("views.generatedFile.exportFailed"))
      } finally {
        setBusyAction(null)
      }
    },
    [t]
  )

  const handleCopy = useCallback(
    async (item: ResolvedImageItem, index: number) => {
      const actionKey = `copy-${index}`
      setBusyAction(actionKey)
      try {
        const ok = await copyImage(item)
        if (!ok) {
          toast.error("复制失败")
          return
        }
        setCopiedIndex(index)
        window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500)
      } catch {
        toast.error("复制失败")
      } finally {
        setBusyAction(null)
      }
    },
    []
  )

  if (outputs.length === 0) {
    return (
      <div className={cn("flex min-h-48 items-center justify-center border [border-color:rgba(15,17,28,0.08)] dark:[border-color:rgba(255,255,255,0.08)] text-foreground/40", className)}>
        <span className="text-sm">{t("imageHistory.previewEmpty")}</span>
      </div>
    )
  }

  const previewItem = previewIndex !== null ? items[previewIndex] : null
  const isSingle = outputs.length === 1

  if (isSingle) {
    const resolved = items[0]
    const src = resolved?.resolvedUrl ?? ""
    const hasFinishedResolution = !isResolving
    const showSkeleton = isResolving && !resolved
    const showError = hasFinishedResolution && !resolved

    return (
      <div className={cn("w-full", className)}>
        <div
          className={cn(
            "group relative w-full max-w-[34rem] overflow-hidden",
            !src && "border [border-color:rgba(15,17,28,0.08)] dark:[border-color:rgba(255,255,255,0.08)]"
          )}
        >
          {src ? (
            <button
              type="button"
              className="relative block w-full cursor-zoom-in overflow-hidden"
              onClick={() => openPreview(0)}
              aria-label={t("imageHistory.previewTitle")}
            >
              <LazyImage src={src} alt={t("input.image.alt")} fit="natural" />
              <span className="pointer-events-none absolute inset-0 transition-colors duration-300 group-hover:bg-foreground/[0.04]" />
            </button>
          ) : null}

          {showSkeleton ? (
            <div className="aspect-[4/3] w-full animate-pulse bg-foreground/[0.04]" />
          ) : null}

          {showError ? (
            <div className="flex aspect-[4/3] w-full items-center justify-center text-foreground/30">
              <ImageIcon className="h-6 w-6" />
            </div>
          ) : null}

          {resolved ? (
            <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={imageActionButtonClass}
                aria-label={t("views.generatedFile.download")}
                title={t("views.generatedFile.download")}
                disabled={busyAction === `download-0`}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDownload(resolved, 0)
                }}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={imageActionButtonClass}
                aria-label={copiedIndex === 0 ? t("actions.copied") : t("actions.copy")}
                title={copiedIndex === 0 ? t("actions.copied") : t("actions.copy")}
                disabled={busyAction === `copy-0`}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleCopy(resolved, 0)
                }}
              >
                {copiedIndex === 0 ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          ) : null}
        </div>

        <Dialog open={previewIndex !== null} onOpenChange={(open) => (!open ? closePreview() : undefined)}>
          <DialogContent className="[&>button]:hidden max-h-[96dvh] max-w-[96vw] overflow-hidden border-none bg-transparent p-0 shadow-none">
            <VisuallyHidden>
              <DialogTitle>{t("imageHistory.previewTitle")}</DialogTitle>
            </VisuallyHidden>
            {previewItem ? (
              <div className="relative flex h-[92dvh] w-[92vw] items-center justify-center">
                <img
                  src={previewItem.resolvedUrl}
                  alt={t("input.image.alt")}
                  className="max-h-full max-w-full select-none object-contain"
                />
                <div className="absolute right-3 top-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label={t("views.generatedFile.download")}
                    onClick={() => void handleDownload(previewItem, previewIndex ?? 0)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label={t("actions.copy")}
                    onClick={() => void handleCopy(previewItem, previewIndex ?? 0)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label="Close"
                    onClick={closePreview}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      <div className={cn("grid w-full gap-2.5", gridClassFor(outputs.length))}>
        {outputs.map((output, index) => {
          const resolved = items[index]
          const src = resolved?.resolvedUrl ?? ""
          const hasFinishedResolution = !isResolving
          const showSkeleton = isResolving && !resolved
          const showError = hasFinishedResolution && !resolved

          return (
            <div
              key={`${getPreferredUrl(output)}-${index}`}
              className={cn(
                "group relative overflow-hidden border [border-color:rgba(15,17,28,0.08)] dark:[border-color:rgba(255,255,255,0.08)]",
                tileClassFor(outputs.length)
              )}
            >
              {src ? (
                <button
                  type="button"
                  className="absolute inset-0 cursor-zoom-in"
                  onClick={() => openPreview(index)}
                  aria-label={t("imageHistory.previewTitle")}
                >
                  <LazyImage src={src} alt={t("input.image.alt")} fit="cover" />
                  <span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:bg-foreground/[0.04]" />
                </button>
              ) : null}

              {showSkeleton ? (
                <div className="absolute inset-0 animate-pulse bg-foreground/[0.04]" />
              ) : null}

              {showError ? (
                <div className="absolute inset-0 flex items-center justify-center text-foreground/30">
                  <ImageIcon className="h-5 w-5" />
                </div>
              ) : null}

              {resolved ? (
                <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={imageActionButtonClass}
                    aria-label={t("views.generatedFile.download")}
                    title={t("views.generatedFile.download")}
                    disabled={busyAction === `download-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDownload(resolved, index)
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={imageActionButtonClass}
                    aria-label={copiedIndex === index ? t("actions.copied") : t("actions.copy")}
                    title={copiedIndex === index ? t("actions.copied") : t("actions.copy")}
                    disabled={busyAction === `copy-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleCopy(resolved, index)
                    }}
                  >
                    {copiedIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <Dialog open={previewIndex !== null} onOpenChange={(open) => (!open ? closePreview() : undefined)}>
        <DialogContent className="[&>button]:hidden max-h-[96dvh] max-w-[96vw] overflow-hidden border-none bg-transparent p-0 shadow-none">
          <VisuallyHidden>
            <DialogTitle>{t("imageHistory.previewTitle")}</DialogTitle>
          </VisuallyHidden>
          {previewItem ? (
            <div className="relative flex h-[92dvh] w-[92vw] items-center justify-center">
              <img
                src={previewItem.resolvedUrl}
                alt={t("input.image.alt")}
                className="max-h-full max-w-full select-none object-contain"
              />
              <div className="absolute right-3 top-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label={t("views.generatedFile.download")}
                    onClick={() => void handleDownload(previewItem, previewIndex ?? 0)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label={t("actions.copy")}
                    onClick={() => void handleCopy(previewItem, previewIndex ?? 0)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 border [border-color:rgba(255,255,255,0.15)] bg-zinc-950/60 text-white hover:bg-zinc-800"
                    aria-label="Close"
                    onClick={closePreview}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
})

export default ImageResultPanel
