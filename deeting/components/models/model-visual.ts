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
  if (normalized === "healthy") return { color: "text-[var(--ok)]", indicator: "bg-[var(--ok)]" }
  if (normalized === "degraded") return { color: "text-[var(--warn)]", indicator: "bg-[var(--warn)]" }
  if (normalized === "down") return { color: "text-[var(--danger)]", indicator: "bg-[var(--danger)]" }
  return null
}

const resolveRuntimeTone = (
  context?: ModelVisualContext
): Pick<ModelVisual, "color" | "indicator"> | null => {
  const statusCode = context?.statusCode?.trim().toLowerCase() ?? ""
  if (context?.hasError || statusCode.includes("error")) {
    return { color: "text-[var(--danger)]", indicator: "bg-[var(--danger)]" }
  }
  if (!context?.isLoading) return null
  if (
    statusCode.startsWith("upstream.request") ||
    statusCode === "upstream.streaming" ||
    statusCode === "upstream.response" ||
    statusCode === "tool.call"
  ) {
    return { color: "text-[var(--info)]", indicator: "bg-[var(--info)]" }
  }
  return null
}

const resolveProviderVisual = (model?: ModelPickerModel): ModelVisual => {
  const ownedBy = model?.owned_by?.toLowerCase() ?? ""
  if (ownedBy.includes("openai")) {
    return { icon: Zap, color: "text-[var(--ok)]", indicator: "bg-[var(--ok)]" }
  }
  if (ownedBy.includes("anthropic") || ownedBy.includes("claude")) {
    return { icon: Cpu, color: "text-[var(--warn)]", indicator: "bg-[var(--warn)]" }
  }
  if (ownedBy.includes("deepseek")) {
    return { icon: Cpu, color: "text-[var(--info)]", indicator: "bg-[var(--info)]" }
  }
  return {
    icon: Cpu,
    color: "text-[var(--ink-3)]",
    indicator: "bg-[var(--hairline-strong)]",
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
  return { ...baseVisual, indicator: "bg-[var(--hairline-strong)]" }
}
