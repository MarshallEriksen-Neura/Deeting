"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Volume2 } from "lucide-react"

import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { cn } from "@/lib/utils"

export interface AudioResultPayload {
  asset?: {
    url: string
    source_kind?: string | null
    content_type?: string | null
    size_bytes?: number | null
    duration_ms?: number | null
  } | null
  asset_url?: string | null
  source_url?: string | null
  content_type?: string | null
  duration_ms?: number | null
  voice?: string | null
  model?: string | null
  transcript?: string | null
  prompt_text?: string | null
}

function resolvePayloadSource(payload: AudioResultPayload) {
  const asset = payload.asset ?? null
  return {
    src:
      asset?.url?.trim() ||
      payload.asset_url?.trim() ||
      payload.source_url?.trim() ||
      "",
    contentType: asset?.content_type ?? payload.content_type ?? null,
    durationMs: asset?.duration_ms ?? payload.duration_ms ?? null,
  }
}

interface AudioResultPanelProps {
  payload: AudioResultPayload
  className?: string
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return null
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

async function resolveAudioSrc(
  src: string,
  contentType?: string | null,
): Promise<string> {
  const trimmed = src.trim()
  if (!trimmed) return ""

  if (trimmed.startsWith("local-asset://")) {
    const sha256 = trimmed.slice("local-asset://".length).replace(/^\/+/, "")
    if (!sha256) return ""
    const { invoke } = await import("@tauri-apps/api/core")
    const result = await invoke<{ data_url: string }>("read_local_chat_asset", {
      payload: {
        sha256,
        content_type: contentType ?? "audio/mpeg",
      },
    })
    return result.data_url
  }

  if (trimmed.startsWith("asset://")) {
    const objectKey = trimmed.slice("asset://".length).replace(/^\/+/, "")
    if (!objectKey) return ""
    const ticket = await prepareDesktopObjectStorageRead({
      object_key: objectKey,
      expires_seconds: 900,
    })
    return ticket.asset_url
  }

  return trimmed
}

export const AudioResultPanel = memo<AudioResultPanelProps>(function AudioResultPanel({
  payload,
  className,
}) {
  const source = useMemo(() => resolvePayloadSource(payload), [payload])
  const [resolvedSrc, setResolvedSrc] = useState(source.src)

  useEffect(() => {
    let cancelled = false

    void resolveAudioSrc(source.src, source.contentType)
      .then((next) => {
        if (!cancelled) setResolvedSrc(next)
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc("")
      })

    return () => {
      cancelled = true
    }
  }, [source.contentType, source.src])

  const durationLabel = useMemo(
    () => formatDuration(source.durationMs),
    [source.durationMs],
  )

  return (
    <div
      className={cn(
        "space-y-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-200/70 text-slate-700 dark:bg-white/10 dark:text-white/70">
          <Volume2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium text-slate-900 dark:text-white">
            Audio Output
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/40">
            {payload.model ? <span>Model: {payload.model}</span> : null}
            {payload.voice ? <span>Voice: {payload.voice}</span> : null}
            {durationLabel ? <span>Duration: {durationLabel}</span> : null}
          </div>
        </div>
      </div>

      {resolvedSrc ? (
        <audio controls preload="none" className="w-full" src={resolvedSrc}>
          Your browser does not support audio playback.
        </audio>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300/80 px-3 py-4 text-sm text-slate-500 dark:border-white/10 dark:text-white/40">
          Audio unavailable
        </div>
      )}

      {payload.prompt_text?.trim() ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 dark:text-white/40">Prompt</div>
          <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3 text-sm text-slate-700 dark:border-white/10 dark:bg-black/20 dark:text-white/70">
            {payload.prompt_text}
          </div>
        </div>
      ) : null}

      {payload.transcript?.trim() ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 dark:text-white/40">Transcript</div>
          <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3 text-sm text-slate-700 dark:border-white/10 dark:bg-black/20 dark:text-white/70">
            {payload.transcript}
          </div>
        </div>
      ) : null}
    </div>
  )
})

export default AudioResultPanel
