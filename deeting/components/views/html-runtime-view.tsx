"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { HtmlRuntimeRefreshSpec } from "@/lib/chat/message-protocol"
import { useI18n } from "@/hooks/use-i18n"
import type { NativeViewProps } from "./registry"

interface HtmlRuntimePayload {
  snapshot_html?: string
  html?: string
  summary?: string
  render_hint?: string
  render_data?: unknown
  initial_data?: unknown
  refresh_spec?: HtmlRuntimeRefreshSpec
}

interface HtmlRuntimeMetadata {
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
  const iframeHeight =
    typeof runtimeMeta.iframe_height === "number"
      ? Math.min(Math.max(runtimeMeta.iframe_height, 180), 720)
      : 280
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
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
      <iframe
        ref={iframeRef}
        title={typeof runtimeMeta.render_hint === "string" ? runtimeMeta.render_hint : "html-runtime-view"}
        srcDoc={snapshotHtml}
        sandbox={sandbox}
        className="w-full bg-white"
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
