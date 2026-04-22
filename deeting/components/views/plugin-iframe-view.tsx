"use client"

import { useRef, useEffect, useCallback, useState, memo } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import type { NativeViewProps } from "./registry"

/**
 * Legacy compatibility ViewBlock for plugin.iframe.
 *
 * The current main UI path prefers html.v1 and asset-backed rendering.
 * This component remains on disk for compatibility work, but is no longer
 * registered in the default native view registry.
 *
 * Lifecycle:
 *  1. Renders a sandboxed <iframe> pointing at metadata.renderer_url.
 *  2. Listens for a postMessage { type: "DEETING_PLUGIN_READY" } from the iframe.
 *  3. Responds with { type: "DEETING_PLUGIN_DATA", payload } so the plugin
 *     can render its UI with the data produced by the skill.
 */

const PLUGIN_READY_TYPE = "DEETING_PLUGIN_READY"
const PLUGIN_DATA_TYPE = "DEETING_PLUGIN_DATA"

const PluginIframeView = memo<NativeViewProps>(function PluginIframeView({
  data,
  metadata,
}) {
  const t = useI18n("chat")
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const rendererUrl = (metadata?.renderer_url as string) ?? ""
  const iframeHeight = (metadata?.iframe_height as number) ?? 320
  const missingRendererUrl = !rendererUrl
  const effectiveError = missingRendererUrl ? t("views.pluginIframe.noUrl") : error

  // Derive expected origin from renderer_url for postMessage origin check
  const expectedOrigin = (() => {
    try {
      return new URL(rendererUrl, window.location.origin).origin
    } catch {
      return ""
    }
  })()

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Only accept messages from the expected origin
      if (event.origin !== expectedOrigin) return

      // Verify the source is our iframe
      if (iframeRef.current?.contentWindow !== event.source) return

      const msg = event.data
      if (typeof msg !== "object" || msg === null) return

      if (msg.type === PLUGIN_READY_TYPE) {
        // Plugin is ready — inject the payload
        iframeRef.current?.contentWindow?.postMessage(
          { type: PLUGIN_DATA_TYPE, payload: data },
          expectedOrigin,
        )
      }
    },
    [data, expectedOrigin],
  )

  useEffect(() => {
    if (!rendererUrl) return

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [rendererUrl, handleMessage])

  const handleLoad = useCallback(() => {
    setLoading(false)
  }, [])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(t("views.pluginIframe.loadError"))
  }, [t])

  if (effectiveError) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive py-2">
        <AlertTriangle size={14} className="shrink-0" />
        <span>{effectiveError}</span>
      </div>
    )
  }

  return (
    <div className="relative w-full" style={{ height: iframeHeight }}>
      {!missingRendererUrl && loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30 rounded">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={rendererUrl}
        title="plugin-view"
        className="h-full w-full border-0 rounded"
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
})

export default PluginIframeView
