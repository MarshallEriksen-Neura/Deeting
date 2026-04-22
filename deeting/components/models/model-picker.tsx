"use client"

import { useMemo, useState } from "react"
import { Check, Search } from "lucide-react"
import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"
import { ScrollArea } from "@/components/ui/shadcn/scroll-area"
import { cn } from "@/lib/utils"
import {
  resolveModelVisual,
  type ModelPickerModel,
} from "./model-visual"

export { resolveModelVisual } from "./model-visual"
export type { ModelPickerModel, ModelVisualContext } from "./model-visual"

export type ModelPickerGroup = {
  instance_id: string
  instance_name: string
  provider?: string
  models: ModelPickerModel[]
  is_platform?: boolean
}

type ModelPickerValueField = "id" | "provider_model_id"

interface ModelPickerProps {
  value?: string
  onChange: (value: string) => void
  modelGroups: ModelPickerGroup[]
  valueField?: ModelPickerValueField
  resolveValue?: (group: ModelPickerGroup, model: ModelPickerModel) => string
  title?: string
  subtitle?: string
  searchPlaceholder: string
  emptyText: string
  noResultsText: string
  disabled?: boolean
  showHeader?: boolean
  className?: string
  scrollAreaClassName?: string
}

export function ModelPicker({
  value,
  onChange,
  modelGroups,
  valueField = "provider_model_id",
  resolveValue,
  title,
  subtitle,
  searchPlaceholder,
  emptyText,
  noResultsText,
  disabled = false,
  showHeader = true,
  className,
  scrollAreaClassName,
}: ModelPickerProps) {
  const [query, setQuery] = useState("")

  const resolveModelValue = (group: ModelPickerGroup, model: ModelPickerModel) => {
    if (resolveValue) return resolveValue(group, model)
    if (valueField === "id") return model.id
    return model.provider_model_id ?? model.id
  }

  const sortedGroups = useMemo(() => {
    const platformGroups: ModelPickerGroup[] = []
    const regularGroups: ModelPickerGroup[] = []
    for (const group of modelGroups) {
      const hasPlatformModel = group.is_platform || group.models.some(m => m.is_platform)
      if (hasPlatformModel) {
        platformGroups.push({ ...group, is_platform: true })
      } else {
        regularGroups.push(group)
      }
    }
    return [...platformGroups, ...regularGroups]
  }, [modelGroups])

  const filteredModelGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sortedGroups
    return sortedGroups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => {
          const name = model.id?.toLowerCase() ?? ""
          const ownedBy = model.owned_by?.toLowerCase() ?? ""
          const providerId = model.provider_model_id?.toLowerCase() ?? ""
          return name.includes(keyword) || ownedBy.includes(keyword) || providerId.includes(keyword)
        }),
      }))
      .filter((group) => group.models.length > 0)
  }, [sortedGroups, query])

  const filteredCount = useMemo(
    () => filteredModelGroups.reduce((sum, group) => sum + group.models.length, 0),
    [filteredModelGroups]
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[1.75rem] border border-[var(--hairline)] bg-[var(--panel-bg)] p-4 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.3)]",
        disabled && "opacity-70",
        className
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col gap-1">
            {title ? (
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ink-3)]">
                {title}
              </span>
            ) : null}
            {subtitle ? (
              <span className="text-[11px] text-[var(--ink-3)]">
                {subtitle}
              </span>
            ) : null}
          </div>
          <span className="rounded-full bg-[var(--panel-bg-inset)] px-2.5 py-0.5 text-[10px] font-mono text-[var(--ink-3)]">
            {filteredCount}
          </span>
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-3)]" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
          className="h-10 rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] pl-9 text-[12px] font-medium text-[var(--ink)] placeholder:text-[var(--ink-3)] shadow-[0_6px_16px_-12px_rgba(15,23,42,0.25)] focus-visible:ring-2 focus-visible:ring-[var(--info-border)]"
        />
      </div>

      {modelGroups.length === 0 ? (
        <div className="px-1 text-[11px] text-[var(--ink-3)]">
          {emptyText}
        </div>
      ) : (
        <ScrollArea className={cn("h-72 pr-1", scrollAreaClassName)}>
          <div className="space-y-3">
            {filteredModelGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-6 text-center text-[11px] text-[var(--ink-3)]">
                {noResultsText}
              </div>
            ) : (
              filteredModelGroups.map((group) => (
                <div
                  key={group.instance_id}
                  className="rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] shadow-[0_10px_24px_-16px_rgba(15,23,42,0.25)]"
                >
                  <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                    <span className="flex items-center gap-1.5 font-black">
                      {group.instance_name}
                    </span>
                    {group.provider ? (
                      <span className="text-[9px] font-semibold text-[var(--ink-4)]">
                        {group.provider}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5 px-2 pb-2">
                    {group.models.map((model) => {
                      const modelValue = resolveModelValue(group, model)
                      const isActive =
                        value === modelValue ||
                        value === model.id ||
                        value === model.provider_model_id
                      const visual = resolveModelVisual(model)
                      const Icon = visual.icon
                      const modelKey =
                        model.provider_model_id ?? `${group.instance_id}:${model.id}`
                      return (
                        <Button
                          key={modelKey}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onChange(modelValue)}
                          disabled={disabled}
                          className={cn(
                            "h-11 justify-between rounded-xl px-3 text-[11px] font-semibold transition-colors",
                            isActive
                              ? "bg-[var(--accent-soft)] text-[var(--ink)] ring-1 ring-[var(--info-border)]"
                              : "text-[var(--ink-2)] hover:bg-[var(--panel-bg)]"
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-full bg-[var(--panel-bg)]",
                                isActive && "bg-[var(--panel-bg)]"
                              )}
                            >
                              <Icon className={`h-3.5 w-3.5 ${visual.color}`} />
                            </span>
                            <span className="flex min-w-0 flex-col text-left leading-tight">
                              <span className="truncate text-[11px] font-semibold">{model.id}</span>
                              {model.owned_by ? (
                                <span className="truncate text-[9px] text-[var(--ink-4)]">
                                  {model.owned_by}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {isActive ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-[var(--hairline-strong)]" />
                          )}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}



