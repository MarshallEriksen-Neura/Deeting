"use client"

import * as React from "react"
import { useTranslations } from "next-intl"

import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { ProviderModel, ModelCapability } from "./types"
import { CAPABILITY_META } from "./types"
import type { ProviderModelUpdate } from "@/lib/api/providers"

interface NumberInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
}

function NumberInput({ label, value, onChange, placeholder, suffix }: NumberInputProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[var(--muted)]">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 bg-white/5 border-white/10"
        />
        {suffix ? (
          <span className="text-xs text-[var(--muted)] whitespace-nowrap">{suffix}</span>
        ) : null}
      </div>
    </div>
  )
}

interface TextInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function TextInput({ label, value, onChange, placeholder }: TextInputProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[var(--muted)]">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 bg-white/5 border-white/10"
      />
    </div>
  )
}

type ReadonlyInputProps = {
  label: string
  value: string
  placeholder?: string
}

function ReadonlyInput({ label, value, placeholder }: ReadonlyInputProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[var(--muted)]">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        readOnly
        className="h-9 bg-white/5 border-white/10 text-xs font-mono text-[var(--muted)]"
      />
    </div>
  )
}

type ModelConfigPanelProps = {
  model: ProviderModel
  onSave?: (model: ProviderModel, payload: ProviderModelUpdate) => Promise<void>
}

export function ModelConfigPanel({ model, onSave }: ModelConfigPanelProps) {
  const t = useTranslations("models.form")
  const tCap = useTranslations("models.capabilities")

  // 初始化表单状态（仅本地）
  const [displayName, setDisplayName] = React.useState(model.display_name || "")
  const [unifiedModelId, setUnifiedModelId] = React.useState(model.unified_model_id || model.id)
  const [weight, setWeight] = React.useState(model.weight?.toString() || "")
  const [priority, setPriority] = React.useState(model.priority?.toString() || "")
  const [inputPrice, setInputPrice] = React.useState(model.pricing.input?.toString() || "")
  const [outputPrice, setOutputPrice] = React.useState(model.pricing.output?.toString() || "")
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(
    model.max_output_tokens?.toString() || ""
  )
  const [rpm, setRpm] = React.useState(model.rpm?.toString() || "")
  const [tpm, setTpm] = React.useState(model.tpm?.toString() || "")
  const [contextWindow, setContextWindow] = React.useState(
    model.context_window ? model.context_window.toString() : ""
  )
  const [capabilities, setCapabilities] = React.useState<ModelCapability[]>(
    model.capabilities?.length ? model.capabilities : ["chat"]
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const initialSnapshot = React.useRef<Record<string, unknown> | null>(null)

  const normalizeNumber = React.useCallback((v: string) => {
    if (v === "" || v == null) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }, [])

  const snapshot = React.useCallback(() => {
    return {
      displayName: (displayName || "").trim(),
      unifiedModelId: (unifiedModelId || "").trim(),
      weight: (weight || "").trim(),
      priority: (priority || "").trim(),
      inputPrice: (inputPrice || "").trim(),
      outputPrice: (outputPrice || "").trim(),
      maxOutputTokens: (maxOutputTokens || "").trim(),
      rpm: (rpm || "").trim(),
      tpm: (tpm || "").trim(),
      contextWindow: (contextWindow || "").trim(),
      capabilities: [...capabilities].sort(),
    }
  }, [
    capabilities,
    contextWindow,
    displayName,
    inputPrice,
    maxOutputTokens,
    outputPrice,
    priority,
    rpm,
    tpm,
    unifiedModelId,
    weight,
  ])

  const hasChanges = React.useMemo(() => {
    if (!initialSnapshot.current) return false
    return JSON.stringify(snapshot()) !== JSON.stringify(initialSnapshot.current)
  }, [snapshot])

  const buildPayload = React.useCallback((): ProviderModelUpdate => {
    const payload: ProviderModelUpdate = {}
    const display = (displayName || "").trim()
    if (display) payload.display_name = display

    const weightNum = normalizeNumber(weight)
    if (weightNum !== undefined) payload.weight = weightNum
    const priorityNum = normalizeNumber(priority)
    if (priorityNum !== undefined) payload.priority = priorityNum

    const inputNum = normalizeNumber(inputPrice)
    const outputNum = normalizeNumber(outputPrice)
    const pricing: Record<string, number> = {}
    if (inputNum !== undefined) pricing.input_per_1k = inputNum
    if (outputNum !== undefined) pricing.output_per_1k = outputNum
    if (Object.keys(pricing).length) payload.pricing_config = pricing

    const maxOutNum = normalizeNumber(maxOutputTokens)
    const rpmNum = normalizeNumber(rpm)
    const tpmNum = normalizeNumber(tpm)
    const limits: Record<string, number> = {}
    if (maxOutNum !== undefined) limits.max_output_tokens = maxOutNum
    if (rpmNum !== undefined) limits.rpm = rpmNum
    if (tpmNum !== undefined) limits.tpm = tpmNum
    if (Object.keys(limits).length) payload.limit_config = limits

    const contextNum = normalizeNumber(contextWindow)
    if (contextNum !== undefined) {
      payload.tokenizer_config = { context_window: contextNum }
    }

    const routing: Record<string, unknown> = {}
    if (capabilities.length) routing.capabilities = capabilities
    const alias = (unifiedModelId || "").trim()
    if (alias && alias !== model.id) routing.unified_model_alias = alias
    if (Object.keys(routing).length) payload.routing_config = routing

    return payload
  }, [
    capabilities,
    contextWindow,
    displayName,
    inputPrice,
    maxOutputTokens,
    model.id,
    normalizeNumber,
    outputPrice,
    priority,
    rpm,
    tpm,
    unifiedModelId,
    weight,
  ])

  const handleSave = React.useCallback(async () => {
    if (!onSave) return
    try {
      setSaving(true)
      setError(null)
      const payload = buildPayload()
      await onSave(model, payload)
      initialSnapshot.current = snapshot()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [buildPayload, model, onSave, snapshot])

  const handleReset = React.useCallback(() => {
    const snap = initialSnapshot.current
    if (!snap) return
    setDisplayName((snap.displayName as string) || "")
    setUnifiedModelId((snap.unifiedModelId as string) || model.id)
    setWeight((snap.weight as string) || "")
    setPriority((snap.priority as string) || "")
    setInputPrice((snap.inputPrice as string) || "")
    setOutputPrice((snap.outputPrice as string) || "")
    setMaxOutputTokens((snap.maxOutputTokens as string) || "")
    setRpm((snap.rpm as string) || "")
    setTpm((snap.tpm as string) || "")
    setContextWindow((snap.contextWindow as string) || "")
    setCapabilities(((snap.capabilities as ModelCapability[]) || ["chat"]) as ModelCapability[])
    setError(null)
  }, [model.id])

  React.useEffect(() => {
    const initial = {
      displayName: model.display_name || "",
      unifiedModelId: model.unified_model_id || model.id,
      weight: model.weight?.toString() || "",
      priority: model.priority?.toString() || "",
      inputPrice: model.pricing.input?.toString() || "",
      outputPrice: model.pricing.output?.toString() || "",
      maxOutputTokens: model.max_output_tokens?.toString() || "",
      rpm: model.rpm?.toString() || "",
      tpm: model.tpm?.toString() || "",
      contextWindow: model.context_window ? model.context_window.toString() : "",
      capabilities: model.capabilities?.length ? model.capabilities : ["chat"],
    }
    setDisplayName(initial.displayName)
    setUnifiedModelId(initial.unifiedModelId)
    setWeight(initial.weight)
    setPriority(initial.priority)
    setInputPrice(initial.inputPrice)
    setOutputPrice(initial.outputPrice)
    setMaxOutputTokens(initial.maxOutputTokens)
    setRpm(initial.rpm)
    setTpm(initial.tpm)
    setContextWindow(initial.contextWindow)
    setCapabilities(initial.capabilities as ModelCapability[])
    setError(null)
    setSaving(false)
    initialSnapshot.current = {
      ...initial,
      capabilities: [...(initial.capabilities as ModelCapability[])].sort(),
    }
  }, [model])

  return (
    <GlassCard className="border border-white/10 bg-white/5">
      <div className="space-y-6">
        {/* 基础信息 */}
        <Section title={t("basic.title")} description={t("basic.desc")}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput
              label={t("basic.displayName")}
              value={displayName}
              onChange={setDisplayName}
              placeholder={model.id}
            />
            <TextInput
              label={t("basic.unifiedId")}
              value={unifiedModelId}
              onChange={setUnifiedModelId}
              placeholder={model.unified_model_id || model.id}
            />
            <ReadonlyInput
              label={t("basic.upstreamPath")}
              value={model.upstream_path || ""}
              placeholder={model.upstream_path ? undefined : "-"}
            />
            <ReadonlyInput
              label={t("basic.requestUrl")}
              value={model.request_url || ""}
              placeholder={model.request_url ? undefined : "-"}
            />
            <NumberInput
              label={t("basic.weight")}
              value={weight}
              onChange={setWeight}
              placeholder="0"
            />
            <NumberInput
              label={t("basic.priority")}
              value={priority}
              onChange={setPriority}
              placeholder="0"
            />
          </div>
        </Section>

        <Separator className="border-white/5" />

        {/* 能力配置 */}
        <Section title={t("capabilities.title")} description={t("capabilities.desc")}>
          <div className="flex flex-wrap gap-2">
            {(
              ["chat", "vision", "audio", "embedding", "code", "reasoning"] as ModelCapability[]
            ).map((cap) => {
              const active = capabilities.includes(cap)
              const meta = CAPABILITY_META[cap]
              return (
                <Badge
                  key={cap}
                  variant={active ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer select-none",
                    active ? "bg-[var(--primary)] text-white" : "border-white/20 text-[var(--muted)]"
                  )}
                  onClick={() =>
                    setCapabilities((prev) =>
                      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
                    )
                  }
                >
                  {meta.icon} {tCap(`${cap}.label`)}
                </Badge>
              )
            })}
          </div>
          <p className="text-xs text-[var(--muted)]">
            {t("capabilities.hint")}
          </p>
        </Section>

        {/* 定价 */}
        <Section title={t("pricing.title")} description={t("pricing.desc")}>
          <div className="grid gap-4 md:grid-cols-2">
            <NumberInput
              label={t("pricing.input")}
              value={inputPrice}
              onChange={setInputPrice}
              placeholder="0.0015"
              suffix="$ / 1k tokens"
            />
            <NumberInput
              label={t("pricing.output")}
              value={outputPrice}
              onChange={setOutputPrice}
              placeholder="0.002"
              suffix="$ / 1k tokens"
            />
          </div>
        </Section>

        <Separator className="border-white/5" />

        {/* 限额 */}
        <Section title={t("limits.title")} description={t("limits.desc")}>
          <div className="grid gap-4 md:grid-cols-3">
            <NumberInput
              label={t("limits.maxOutput")}
              value={maxOutputTokens}
              onChange={setMaxOutputTokens}
              placeholder="4096"
              suffix="tokens"
            />
            <NumberInput
              label={t("limits.rpm")}
              value={rpm}
              onChange={setRpm}
              placeholder="60"
              suffix="req/min"
            />
            <NumberInput
              label={t("limits.tpm")}
              value={tpm}
              onChange={setTpm}
              placeholder="90000"
              suffix="tokens/min"
            />
          </div>
        </Section>

        <Separator className="border-white/5" />

        {/* Tokenizer */}
        <Section title={t("tokenizer.title")} description={t("tokenizer.desc")}>
          <div className="grid gap-4 md:grid-cols-2">
            <NumberInput
              label={t("tokenizer.context")}
              value={contextWindow}
              onChange={setContextWindow}
              placeholder="128000"
              suffix="tokens"
            />
          </div>
        </Section>

        <Separator className="border-white/5" />

        {error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : null}

        <div className="flex justify-end gap-3">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!hasChanges || saving}
          >
            {t("actions.reset")}
          </GlassButton>
          <GlassButton
            variant="default"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              void handleSave()
            }}
            disabled={!hasChanges || saving}
            loading={saving}
          >
            {saving ? t("actions.saving") : t("actions.save")}
          </GlassButton>
        </div>
      </div>
    </GlassCard>
  )
}

function Section({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <div className="text-sm font-medium text-[var(--foreground)]">{title}</div>
        {description ? (
          <p className="text-xs text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
