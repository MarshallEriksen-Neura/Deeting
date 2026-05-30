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
    case "context.manifest.loaded": {
      const sources = Array.isArray(meta?.available_sources)
        ? meta.available_sources.length
        : 0
      const tools = Array.isArray(meta?.available_tools)
        ? meta.available_tools.length
        : 0
      return t("status.detail.contextManifestLoaded", { sources, tools })
    }
    case "knowledge.context.loading": {
      const selectedFiles = Number(meta?.selected_files ?? 0)
      return t("status.detail.knowledgeContextLoading", { selectedFiles })
    }
    case "knowledge.context.loaded": {
      const selectedFiles = Number(meta?.selected_files ?? 0)
      const count = Number(meta?.count ?? 0)
      const overviewCount = Number(meta?.overview_count ?? 0)
      const fallbackUsed = Boolean(meta?.fallback_used)
      if (count > 0 && fallbackUsed) {
        return t("status.detail.knowledgeContextLoadedFallback", {
          selectedFiles,
          count,
          overviewCount,
        })
      }
      if (count > 0) {
        return t("status.detail.knowledgeContextLoaded", {
          selectedFiles,
          count,
          overviewCount,
        })
      }
      if (overviewCount > 0) {
        return t("status.detail.knowledgeOverviewLoaded", {
          selectedFiles,
          overviewCount,
        })
      }
      return t("status.detail.knowledgeContextEmpty", { selectedFiles })
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
      const totalLatency = Number(meta?.total_latency_ms ?? meta?.latency_ms ?? 0)
      const upstreamLatency = Number(meta?.upstream_latency_ms ?? 0)
      const orchestratorLatency = Number(meta?.orchestrator_latency_ms ?? 0)
      if (Number.isFinite(totalLatency) && totalLatency > 0 && Number.isFinite(upstreamLatency) && upstreamLatency > 0) {
        return t("status.detail.upstreamResponseWithBreakdown", {
          total: Math.max(0, Math.round(totalLatency)),
          upstream: Math.max(0, Math.round(upstreamLatency)),
          local: Math.max(0, Math.round(orchestratorLatency)),
        })
      }
      const latency = Number.isFinite(totalLatency) ? Math.max(0, Math.round(totalLatency)) : 0
      return t("status.detail.upstreamResponse", { latency })
    }
    case "world_model.frame.bootstrap": {
      const goal = typeof meta?.goal === "string" && meta.goal.trim()
        ? meta.goal.trim()
        : null
      return goal
        ? t("status.detail.worldModelFrameBootstrapGoal", { goal })
        : t("status.detail.worldModelFrameBootstrap")
    }
    case "world_model.frame_refresh.request":
      return t("status.detail.worldModelFrameRefreshRequest")
    case "world_model.frame_refresh.updated": {
      const facts = Number(meta?.facts ?? 0)
      const assumptions = Number(meta?.assumptions ?? 0)
      const resolved = Number(meta?.resolved_unknowns ?? 0)
      if (facts > 0 || assumptions > 0 || resolved > 0) {
        return t("status.detail.worldModelFrameRefreshUpdatedSummary", { facts, assumptions, resolved })
      }
      return t("status.detail.worldModelFrameRefreshUpdated")
    }
    case "world_model.frame_refresh.failed":
      return t("status.detail.worldModelFrameRefreshFailed")
    case "runtime.phase_executor.frame_resolved":
      return t("status.detail.worldModelFrameResolved")
    case "tool.call": {
      const name = String(meta?.name ?? "")
      return t("status.detail.toolCall", { name })
    }
    case "assistant.selected": {
      const name = String(meta?.assistant_name ?? "")
      return t("status.detail.assistantSelected", { name })
    }
    case "approval.required": {
      const name = String(meta?.tool_name ?? "").trim()
      return name
        ? t("status.detail.approvalRequired", { name })
        : t("status.detail.approvalRequiredFallback")
    }
    case "approval.executing": {
      const name = String(meta?.tool_name ?? "").trim()
      return name
        ? t("status.detail.approvalExecuting", { name })
        : t("status.detail.approvalExecutingFallback")
    }
    default:
      return null
  }
}

const WORLD_MODEL_CODES = new Set([
  "world_model.frame.bootstrap",
  "world_model.frame_refresh.request",
  "world_model.frame_refresh.updated",
  "world_model.frame_refresh.failed",
])

export interface WorldModelSummary {
  goal: string | null
  facts: number
  assumptions: number
  unknowns: number
  resolvedUnknowns: number
  updateFacts: string[]
  updateAssumptions: string[]
  updateUnknowns: string[]
}

export function resolveWorldModelSummary(
  code?: string | null,
  meta?: Record<string, unknown> | null,
): WorldModelSummary | null {
  if (!code || !WORLD_MODEL_CODES.has(code)) return null

  const goal = typeof meta?.goal === "string" && meta.goal.trim()
    ? meta.goal.trim()
    : null
  const facts = Number(meta?.facts ?? 0)
  const assumptions = Number(meta?.assumptions ?? 0)
  const unknowns = Number(meta?.unknowns ?? 0)
  const resolvedUnknowns = Number(meta?.resolved_unknowns ?? 0)
  const updateFacts = Array.isArray(meta?.update_facts) ? meta.update_facts as string[] : []
  const updateAssumptions = Array.isArray(meta?.update_assumptions) ? meta.update_assumptions as string[] : []
  const updateUnknowns = Array.isArray(meta?.update_unknowns) ? meta.update_unknowns as string[] : []

  return { goal, facts, assumptions, unknowns, resolvedUnknowns, updateFacts, updateAssumptions, updateUnknowns }
}
