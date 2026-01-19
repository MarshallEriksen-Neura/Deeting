"use client"

import { useMemo, useState } from "react"
import { Check, Cpu, Search, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type ModelPickerModel = {
  id: string
  owned_by?: string
  provider_model_id?: string
}

export type ModelPickerGroup = {
  instance_id: string
  instance_name: string
  provider?: string
  models: ModelPickerModel[]
}

type ModelPickerValueField = "id" | "provider_model_id"

type ModelVisual = {
  icon: typeof Cpu
  color: string
  indicator: string
}

export function resolveModelVisual(model?: ModelPickerModel): ModelVisual {
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

interface ModelPickerProps {
  value?: string
  onChange: (value: string) => void
  modelGroups: ModelPickerGroup[]
  valueField?: ModelPickerValueField
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

  const resolveModelValue = (model: ModelPickerModel) => {
    if (valueField === "id") return model.id
    return model.provider_model_id ?? model.id
  }

  const filteredModelGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return modelGroups
    return modelGroups
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
  }, [modelGroups, query])

  const filteredCount = useMemo(
    () => filteredModelGroups.reduce((sum, group) => sum + group.models.length, 0),
    [filteredModelGroups]
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[1.75rem] bg-white/80 dark:bg-white/5 border border-black/5 dark:border-white/10 p-4 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.3)]",
        disabled && "opacity-70",
        className
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col gap-1">
            {title ? (
              <span className="text-[10px] font-black text-black/55 dark:text-white/60 uppercase tracking-[0.2em]">
                {title}
              </span>
            ) : null}
            {subtitle ? (
              <span className="text-[11px] text-black/40 dark:text-white/40">
                {subtitle}
              </span>
            ) : null}
          </div>
          <span className="rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-0.5 text-[10px] font-mono text-black/40 dark:text-white/40">
            {filteredCount}
          </span>
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30 dark:text-white/30" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
          className="h-10 rounded-full border-0 bg-white/90 dark:bg-black/40 pl-9 text-[12px] font-medium text-black/80 dark:text-white/80 placeholder:text-black/30 dark:placeholder:text-white/30 shadow-[0_6px_16px_-12px_rgba(15,23,42,0.25)] focus-visible:ring-2 focus-visible:ring-blue-500/30"
        />
      </div>

      {modelGroups.length === 0 ? (
        <div className="text-[11px] text-black/40 dark:text-white/40 px-1">
          {emptyText}
        </div>
      ) : (
        <ScrollArea className={cn("h-72 pr-1", scrollAreaClassName)}>
          <div className="space-y-3">
            {filteredModelGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-6 text-center text-[11px] text-black/40 dark:text-white/40">
                {noResultsText}
              </div>
            ) : (
              filteredModelGroups.map((group) => (
                <div
                  key={group.instance_id}
                  className="rounded-2xl bg-white/80 dark:bg-black/30 border border-black/5 dark:border-white/10 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.25)]"
                >
                  <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-black/40 dark:text-white/40">
                    <span className="font-black">{group.instance_name}</span>
                    {group.provider ? (
                      <span className="text-[9px] font-semibold text-black/35 dark:text-white/35">
                        {group.provider}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5 px-2 pb-2">
                    {group.models.map((model) => {
                      const modelValue = resolveModelValue(model)
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
                              ? "bg-black/10 text-black dark:bg-white/10 dark:text-white ring-1 ring-blue-500/25"
                              : "text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5"
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-full bg-black/5 dark:bg-white/10",
                                isActive && "bg-white/80 dark:bg-black/60"
                              )}
                            >
                              <Icon className={`h-3.5 w-3.5 ${visual.color}`} />
                            </span>
                            <span className="flex min-w-0 flex-col text-left leading-tight">
                              <span className="truncate text-[11px] font-semibold">{model.id}</span>
                              {model.owned_by ? (
                                <span className="truncate text-[9px] text-black/35 dark:text-white/35">
                                  {model.owned_by}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {isActive ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-black/10 dark:bg-white/10" />
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
