"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { HtmlRuntimeRefreshSpec } from "@/lib/chat/message-protocol"
import { useI18n } from "@/hooks/use-i18n"
import { cn } from "@/lib/utils"
import type { NativeViewProps } from "./registry"

interface HtmlRuntimePayload {
  asset_id?: string
  snapshot_html?: string
  html?: string
  summary?: string
  render_hint?: string
  render_data?: unknown
  initial_data?: unknown
  refresh_spec?: HtmlRuntimeRefreshSpec
}

interface HtmlRuntimeMetadata {
  asset_id?: string
  render_hint?: string
  runtime_mode?: "html_static" | "html_interactive" | "trusted_local_bundle"
  template_id?: string
  template_version?: string
  iframe_height?: number
  snapshot_mode?: "frozen"
  snapshot_created_at?: string
  live_channel_id?: string
  refresh_interval_ms?: number
  expires_at_ms?: number
  allow_live_updates?: boolean
}

const DEFAULT_HTML_RUNTIME_HEIGHT = 520
const MIN_HTML_RUNTIME_HEIGHT = 360
const MAX_HTML_RUNTIME_HEIGHT = 960

function resolveIframeHeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HTML_RUNTIME_HEIGHT
  }

  const normalizedValue = Math.round(value)

  // Older render blocks persisted a compact default that clipped most of the preview.
  if (normalizedValue <= MIN_HTML_RUNTIME_HEIGHT) {
    return DEFAULT_HTML_RUNTIME_HEIGHT
  }

  return Math.min(Math.max(normalizedValue, MIN_HTML_RUNTIME_HEIGHT), MAX_HTML_RUNTIME_HEIGHT)
}

function formatAssetLabel(metadata: HtmlRuntimeMetadata, payload: HtmlRuntimePayload | null): string | null {
  const rawId =
    (typeof metadata.asset_id === "string" && metadata.asset_id.trim()) ||
    (typeof payload?.asset_id === "string" && payload.asset_id.trim()) ||
    (typeof metadata.template_id === "string" && metadata.template_id.trim()) ||
    ""

  if (!rawId) return null

  const normalizedIdSource = rawId
    .replace(/^[a-z]+:\/\//i, "")
    .split("/")
    .filter(Boolean)
    .slice(-1)[0]
  const normalizedId = normalizedIdSource
    ? normalizedIdSource.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()
    : null

  if (!normalizedId) return null

  const version =
    typeof metadata.template_version === "string" && metadata.template_version.trim()
      ? metadata.template_version.trim().replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()
      : ""

  if (version && !normalizedId.endsWith(version)) {
    return `${normalizedId}_${version}`
  }

  return normalizedId
}

function toPayload(data: unknown): HtmlRuntimePayload | null {
  if (!data || typeof data !== "object") return null
  return data as HtmlRuntimePayload
}

function toMetadata(data: Record<string, unknown> | undefined): HtmlRuntimeMetadata {
  return (data ?? {}) as HtmlRuntimeMetadata
}

const RENDER_INIT_TYPE = "DEETING_RENDER_INIT"
const RENDER_UPDATE_TYPE = "DEETING_RENDER_UPDATE"

const HtmlRuntimeView = memo<NativeViewProps>(function HtmlRuntimeView({ data, metadata }) {
  const t = useI18n("chat")
  const payload = toPayload(data)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const runtimeMeta = useMemo(() => toMetadata(metadata), [metadata])
  const snapshotHtml =
    (typeof payload?.snapshot_html === "string" && payload.snapshot_html.trim()) ||
    (typeof payload?.html === "string" && payload.html.trim()) ||
    ""
  const renderData =
    payload && "render_data" in payload ? payload.render_data : payload?.initial_data
  const fallbackSummary =
    (typeof payload?.summary === "string" && payload.summary.trim()) ||
    (typeof payload?.render_hint === "string" && payload.render_hint.trim()) ||
    ""
  const iframeHeight = resolveIframeHeight(runtimeMeta.iframe_height)
  const assetLabel = formatAssetLabel(runtimeMeta, payload)
  const runtimeMode = runtimeMeta.runtime_mode ?? "html_static"
  const sandbox = useMemo(() => {
    if (runtimeMode === "trusted_local_bundle") {
      return "allow-scripts allow-forms"
    }
    if (runtimeMode === "html_interactive") {
      return "allow-scripts"
    }
    return ""
  }, [runtimeMode])

  const postRenderMessage = useCallback(
    (type: string, nextData: unknown) => {
      const target = iframeRef.current?.contentWindow
      if (!target) return
      target.postMessage(
        {
          type,
          payload: nextData,
          metadata: runtimeMeta,
        },
        "*"
      )
    },
    [runtimeMeta]
  )

  useEffect(() => {
    if (!isLoaded) return
    if (runtimeMode === "html_static") return
    postRenderMessage(RENDER_UPDATE_TYPE, renderData)
  }, [isLoaded, postRenderMessage, renderData, runtimeMode])

  if (!payload) {
    return <div className="py-2 text-xs text-muted-foreground">{t("views.invalidPayload")}</div>
  }

  if (!snapshotHtml) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {fallbackSummary || t("views.invalidPayload")}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative w-full origin-top overflow-hidden transition-[max-height,opacity,transform,filter] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isLoaded ? "max-h-[1200px] opacity-100 scale-y-100 blur-0" : "max-h-0 opacity-0 scale-y-95 blur-sm"
      )}
    >
      {assetLabel ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="rounded-full border border-white/45 bg-white/35 px-2.5 py-1 text-[10px] font-medium tracking-[0.16em] text-slate-600 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            {`ASSET: ${assetLabel}`}
          </div>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={typeof runtimeMeta.render_hint === "string" ? runtimeMeta.render_hint : "html-runtime-view"}
        srcDoc={snapshotHtml}
        sandbox={sandbox}
        className="block w-full rounded-[30px] bg-transparent shadow-none"
        style={{ height: `${iframeHeight}px` }}
        loading="lazy"
        onLoad={() => {
          setIsLoaded(true)
          if (runtimeMode !== "html_static") {
            postRenderMessage(RENDER_INIT_TYPE, renderData)
          }
        }}
      />
    </div>
  )
})

export default HtmlRuntimeView
