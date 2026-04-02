"use client"

import { Button } from "@/components/ui/button"
import { ModelPickerField } from "@/components/models/model-picker-field"
import type { ModelGroup } from "@/lib/api/models"

import type { TaskAgentModelOption } from "./task-agent-editor-types"
import {
  buildTaskAgentModelOptionValue,
  DEFAULT_TASK_AGENT_MODEL_VALUE,
} from "./task-agents-helpers"

type Translation = (key: string, values?: Record<string, string | number>) => string

type TaskAgentModelPickerFieldProps = {
  t: Translation
  id?: string
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  onValueChange: (value: string) => void
}

export function TaskAgentModelPickerField({
  t,
  id = "task-agent-model",
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  isLoadingModels,
  modelGroups,
  onValueChange,
}: TaskAgentModelPickerFieldProps) {
  const pickerValue = selectedTaskAgentModelOption
    ? taskAgentModelSelectValue
    : unknownTaskAgentModelLabel

  const hasSelectedModel = Boolean(selectedTaskAgentModelOption || unknownTaskAgentModelLabel)

  return (
    <div className="space-y-2">
      <ModelPickerField
        id={id}
        label={t("editor.fields.model")}
        placeholder={t("editor.placeholders.model")}
        value={pickerValue}
        onChange={onValueChange}
        disabled={isLoadingModels}
        isLoading={isLoadingModels}
        loadingText={t("editor.modelPicker.loading")}
        searchPlaceholder={t("editor.modelPicker.searchPlaceholder")}
        emptyText={t("editor.modelPicker.empty")}
        noResultsText={t("editor.modelPicker.noResults")}
        modelGroups={modelGroups}
        resolveValue={(group, model) =>
          buildTaskAgentModelOptionValue(
            group.instance_id,
            model.provider_model_id ?? model.id,
          )
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-h-8 flex-1">
          {unknownTaskAgentModelLabel && !selectedTaskAgentModelOption ? (
            <p className="text-[11px] text-amber-300/90">
              {t("editor.modelPicker.currentUnlistedHint")}
            </p>
          ) : (
            <p className="text-[11px] text-[var(--muted)]/80">
              {t("editor.modelPicker.helper")}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 rounded-lg border-white/10 px-3 text-[11px]"
          disabled={!hasSelectedModel}
          onClick={() => onValueChange(DEFAULT_TASK_AGENT_MODEL_VALUE)}
        >
          {t("editor.modelPicker.useDefault")}
        </Button>
      </div>
    </div>
  )
}
