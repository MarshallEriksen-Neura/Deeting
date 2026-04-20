"use client"

import { Coins, Cpu, Zap } from "lucide-react"

export type ModelPickerModel = {
  id: string
  owned_by?: string
  provider_model_id?: string
  health_status?: string | null
  is_platform?: boolean
  pricing?: Record<string, unknown> | null
}

type ModelVisual = {
  icon: typeof Cpu | typeof Zap | typeof Coins
  color: string
  indicator: string
}

export type ModelVisualContext = {
  healthStatus?: string | null
  statusCode?: string | null
  isLoading?: boolean
  hasError?: boolean
}

const normalizeHealthStatus = (value?: string | null) => {
  const status = value?.trim().toLowerCase()
  if (!status) return null
  if (["online", "healthy", "up", "ok"].includes(status)) return "healthy"
  if (["degraded", "warning"].includes(status)) return "degraded"
  if (["offline", "down", "error"].includes(status)) return "down"
  return null
}

const resolveHealthTone = (
  healthStatus?: string | null
): Pick<ModelVisual, "color" | "indicator"> | null => {
  const normalized = normalizeHealthStatus(healthStatus)
  if (normalized === "healthy") return { color: "text-emerald-500", indicator: "bg-emerald-500" }
  if (normalized === "degraded") return { color: "text-amber-500", indicator: "bg-amber-500" }
  if (normalized === "down") return { color: "text-rose-500", indicator: "bg-rose-500" }
  return null
}

const resolveRuntimeTone = (
  context?: ModelVisualContext
): Pick<ModelVisual, "color" | "indicator"> | null => {
  const statusCode = context?.statusCode?.trim().toLowerCase() ?? ""
  if (context?.hasError || statusCode.includes("error")) {
    return { color: "text-rose-500", indicator: "bg-rose-500" }
  }
  if (!context?.isLoading) return null
  if (
    statusCode.startsWith("upstream.request") ||
    statusCode === "upstream.streaming" ||
    statusCode === "upstream.response" ||
    statusCode === "tool.call"
  ) {
    return { color: "text-blue-500", indicator: "bg-blue-500" }
  }
  return null
}

const resolveProviderVisual = (model?: ModelPickerModel): ModelVisual => {
  const ownedBy = model?.owned_by?.toLowerCase() ?? ""
  if (ownedBy.includes("openai")) {
    return { icon: Zap, color: "text-emerald-500", indicator: "bg-emerald-500" }
  }
  if (ownedBy.includes("anthropic") || ownedBy.includes("claude")) {
    return { icon: Cpu, color: "text-orange-500", indicator: "bg-orange-500" }
  }
  if (ownedBy.includes("deepseek")) {
    return { icon: Cpu, color: "text-blue-500", indicator: "bg-blue-500" }
  }
  return {
    icon: Cpu,
    color: "text-black/40 dark:text-white/40",
    indicator: "bg-black/30 dark:bg-white/30",
  }
}

export function resolveModelVisual(
  model?: ModelPickerModel,
  context?: ModelVisualContext
): ModelVisual {
  const baseVisual = resolveProviderVisual(model)
  const healthTone = resolveHealthTone(context?.healthStatus ?? model?.health_status ?? null)
  if (healthTone) return { ...baseVisual, ...healthTone }
  const runtimeTone = resolveRuntimeTone(context)
  if (runtimeTone) return { ...baseVisual, ...runtimeTone }
  return { ...baseVisual, indicator: "bg-black/30 dark:bg-white/30" }
}
