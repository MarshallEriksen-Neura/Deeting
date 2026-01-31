import type { useI18n } from "@/hooks/use-i18n"

type Translator = ReturnType<typeof useI18n>

export function resolveStatusDetail(
  t: Translator,
  code?: string | null,
  meta?: Record<string, unknown> | null
) {
  if (!code) return null

  switch (code) {
    case "context.loaded": {
      const count = Number(meta?.count ?? 0)
      const hasSummary = Boolean(meta?.has_summary)
      return hasSummary
        ? t("status.detail.contextLoadedWithSummary", { count })
        : t("status.detail.contextLoaded", { count })
    }
    case "routing.selected": {
      const candidates = Number(meta?.candidates ?? 0)
      const provider = String(meta?.provider ?? "")
      return t("status.detail.routingSelected", { candidates, provider })
    }
    case "template.rendered": {
      const engine = String(meta?.engine ?? "")
      return t("status.detail.templateRendered", { engine })
    }
    case "upstream.request.stream":
      return t("status.detail.upstreamRequestStream")
    case "upstream.request.batch":
      return t("status.detail.upstreamRequestBatch")
    case "upstream.streaming":
      return t("status.detail.upstreamStreaming")
    case "upstream.response": {
      const latency = Number(meta?.latency_ms ?? 0)
      return t("status.detail.upstreamResponse", { latency })
    }
    case "tool.call": {
      const name = String(meta?.name ?? "")
      return t("status.detail.toolCall", { name })
    }
    case "assistant.selected": {
      const name = String(meta?.assistant_name ?? "")
      return t("status.detail.assistantSelected", { name })
    }
    default:
      return null
  }
}
