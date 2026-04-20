"use client"

import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"

import { resolveModelVisual } from "@/components/models/model-visual"
import { Label } from "@/ui/shadcn/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover"
import type { ModelGroup } from "@/lib/api/models"
import { cn } from "@/lib/utils"

import { ModelPicker, type ModelPickerModel } from "./model-picker"

type SelectedModel = {
  model: ModelGroup["models"][number]
  group?: ModelGroup
}

const findSelectedModel = (
  value: string | undefined,
  groups: ModelGroup[],
  resolveValue?: (
    group: ModelGroup,
    model: ModelGroup["models"][number],
  ) => string,
): SelectedModel | null => {
  if (!value) return null
  for (const group of groups) {
    for (const model of group.models) {
      const modelValue = resolveValue
        ? resolveValue(group, model)
        : model.provider_model_id ?? model.id
      if (
        modelValue === value ||
        model.id === value ||
        model.provider_model_id === value
      ) {
        return { model, group }
      }
    }
  }
  return null
}

export function ModelPickerField({
  id,
  label,
  placeholder,
  value,
  onChange,
  description,
  required,
  disabled = false,
  isLoading = false,
  loadingText,
  searchPlaceholder,
  emptyText,
  noResultsText,
  modelGroups,
  resolveValue,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  description?: string
  required?: boolean
  disabled?: boolean
  isLoading?: boolean
  loadingText?: string
  searchPlaceholder: string
  emptyText: string
  noResultsText: string
  modelGroups: ModelGroup[]
  resolveValue?: (
    group: ModelGroup,
    model: ModelGroup["models"][number],
  ) => string
}) {
  const [isOpen, setIsOpen] = useState(false)

  const pickerModelGroups = useMemo(
    () =>
      modelGroups.map((group) => ({
        ...group,
        models: group.models.map(
          (model): ModelPickerModel => ({
            ...model,
            provider_model_id: model.provider_model_id ?? undefined,
          })
        ),
      })),
    [modelGroups]
  )

  const selectedValue = value.trim()
  const selectedModel = findSelectedModel(selectedValue, modelGroups, resolveValue)
  const visual = resolveModelVisual(
    selectedModel
      ? {
          ...selectedModel.model,
          provider_model_id: selectedModel.model.provider_model_id ?? undefined,
        }
      : undefined
  )
  const Icon = visual.icon

  const title =
    isLoading && !selectedValue
      ? loadingText || placeholder
      : selectedModel?.model.id || selectedValue || placeholder
  const subtitle = selectedModel
    ? selectedModel.model.owned_by ||
      selectedModel.group?.provider ||
      selectedModel.group?.instance_name
    : selectedValue
      ? "custom"
      : null
  const isUnlisted = Boolean(selectedValue) && !selectedModel && !isLoading

  return (
    <div>
      <Label
        htmlFor={id}
        className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]"
      >
        {label}
        {required ? <span className="text-red-400">*</span> : null}
      </Label>

      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (disabled) return
          setIsOpen(open)
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-expanded={isOpen}
            className={cn(
              "flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-left transition-colors",
              "hover:border-white/15 hover:bg-[var(--foreground)]/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--foreground)]/[0.06]">
                <Icon className={`h-4 w-4 ${visual.color}`} />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span
                  className={cn(
                    "truncate text-sm",
                    selectedValue || isLoading
                      ? "font-medium text-[var(--foreground)]"
                      : "text-[var(--muted)]/70"
                  )}
                >
                  {title}
                </span>
                {subtitle ? (
                  <span className="truncate text-[11px] text-[var(--muted)]/80">
                    {subtitle}
                  </span>
                ) : null}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(520px,92vw)] p-0"
          align="start"
          side="bottom"
          sideOffset={8}
        >
          {isOpen ? (
            <ModelPicker
              value={selectedValue}
              onChange={(nextValue) => {
                onChange(nextValue)
                setIsOpen(false)
              }}
              modelGroups={pickerModelGroups}
              resolveValue={resolveValue}
              title={label}
              subtitle={placeholder}
              searchPlaceholder={searchPlaceholder}
              emptyText={emptyText}
              noResultsText={noResultsText}
              disabled={disabled}
              scrollAreaClassName="h-64 pr-1"
              className="rounded-[1.5rem] border border-white/10 bg-[var(--background)] shadow-[0_20px_60px_-30px_rgba(15,23,42,0.6)]"
            />
          ) : null}
        </PopoverContent>
      </Popover>

      {description ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]/80">{description}</p>
      ) : null}
      {isUnlisted ? (
        <p className="mt-1 text-[11px] text-amber-300/90">{selectedValue}</p>
      ) : null}
    </div>
  )
}
