"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Image as ImageIcon } from "lucide-react"

import { useLazyImage } from "@/hooks/use-lazy-image"
import { useI18n } from "@/hooks/use-i18n"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
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

const LazyImage = memo<{
  src: string
  alt: string
  contentType?: string | null
  className?: string
}>(({ src, alt, contentType, className }) => {
  const [resolvedSrc, setResolvedSrc] = useState(src)

  useEffect(() => {
    let cancelled = false

    const resolveSrc = async () => {
      const trimmed = src.trim()
      if (!trimmed) {
        if (!cancelled) setResolvedSrc("")
        return
      }
      if (trimmed.startsWith("local-asset://")) {
        const sha256 = trimmed.slice("local-asset://".length).replace(/^\/+/, "")
        if (!sha256) {
          if (!cancelled) setResolvedSrc("")
          return
        }
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const result = await invoke<{ data_url: string }>("read_local_chat_asset", {
            payload: {
              sha256,
              content_type: contentType ?? "image/png",
            },
          })
          if (!cancelled) setResolvedSrc(result.data_url)
          return
        } catch {
          if (!cancelled) setResolvedSrc("")
          return
        }
      }
      if (trimmed.startsWith("asset://")) {
        const objectKey = trimmed.slice("asset://".length).replace(/^\/+/, "")
        if (!objectKey) {
          if (!cancelled) setResolvedSrc("")
          return
        }
        try {
          const ticket = await prepareDesktopObjectStorageRead({
            object_key: objectKey,
            expires_seconds: 900,
          })
          if (!cancelled) setResolvedSrc(ticket.asset_url)
          return
        } catch {
          if (!cancelled) setResolvedSrc("")
          return
        }
      }
      if (!cancelled) setResolvedSrc(trimmed)
    }

    void resolveSrc()
    return () => {
      cancelled = true
    }
  }, [contentType, src])

  const { imageSrc, isLoading, error, imgRef } = useLazyImage({
    src: resolvedSrc,
    rootMargin: "50px",
    threshold: 0.01,
  })

  return (
    <>
      <img
        ref={imgRef}
        src={imageSrc ?? undefined}
        alt={alt}
        className={cn(
          "object-contain w-full h-full transition-opacity",
          (isLoading || !imageSrc || error) && "opacity-0",
          className
        )}
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-white/30">
          <ImageIcon className="h-5 w-5" />
        </div>
      ) : null}
      {!error && (isLoading || !imageSrc) ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-white/5">
          <div className="w-5 h-5 border-2 border-slate-300 dark:border-white/20 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : null}
    </>
  )
})

LazyImage.displayName = "LazyImage"

function normalizeOutputs(payload: ImageResultPanelPayload): ImageResultOutputItem[] {
  const outputs = Array.isArray(payload.outputs) ? payload.outputs.filter(Boolean) : []
  if (outputs.length > 0) {
    return outputs
  }
  if (payload.preview) {
    return [payload.preview]
  }
  return []
}

export const ImageResultPanel = memo<ImageResultPanelProps>(function ImageResultPanel({
  payload,
  className,
}) {
  const t = useI18n("chat")
  const outputs = useMemo(() => normalizeOutputs(payload), [payload])
  const [selectedIndex, setSelectedIndex] = useState(0)

  const safeIndex = Math.min(selectedIndex, Math.max(outputs.length - 1, 0))
  const selected = outputs[safeIndex] ?? payload.preview ?? null
  const selectedUrl = selected?.asset_url ?? selected?.source_url ?? ""
  const prompt = payload.prompt?.trim() || ""
  const model = payload.model?.trim() || ""

  return (
    <div className={cn("space-y-4", className)}>
      <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-white/5">
        {selectedUrl ? (
          <LazyImage
            src={selectedUrl}
            contentType={selected?.content_type}
            alt={prompt || model || "generated image"}
            className="w-full h-full"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-white/30 gap-2">
            <ImageIcon className="h-6 w-6" />
            <span className="text-xs">{t("imageHistory.previewEmpty")}</span>
          </div>
        )}
      </div>

      {outputs.length > 1 ? (
        <div className="grid grid-cols-4 gap-2">
          {outputs.map((item, index) => {
            const url = item.asset_url ?? item.source_url ?? ""
            const active = index === safeIndex
            return (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-xl border bg-slate-100 dark:bg-white/5",
                  active
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-slate-200/70 dark:border-white/10"
                )}
              >
                {url ? (
                  <LazyImage
                    src={url}
                    contentType={item.content_type}
                    alt={`${prompt || model || "generated image"} ${index + 1}`}
                    className="w-full h-full"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-white/30">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      ) : null}

      {prompt ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-white/40">{t("imageHistory.promptLabel")}</p>
          <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.03] p-3 text-sm text-slate-700 dark:text-white/70 whitespace-pre-wrap break-words">
            {prompt}
          </div>
        </div>
      ) : null}

      {model ? <div className="text-[10px] text-slate-400 dark:text-white/30">{model}</div> : null}
    </div>
  )
})

export default ImageResultPanel
