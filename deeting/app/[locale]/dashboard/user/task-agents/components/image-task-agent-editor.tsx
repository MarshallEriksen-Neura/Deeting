"use client"

import type { ModelGroup } from "@/lib/api/models"
import { Switch } from "@/components/ui/shadcn/switch"
import { TaskAgentModelPickerField } from "./task-agent-model-picker-field"
import type {
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

type Translation = (key: string, values?: Record<string, string | number>) => string

type ImageTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  parsedImageExtraParamsError: string | null
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  updateDraft: <K extends keyof TaskAgentDraft>(
    key: K,
    value: TaskAgentDraft[K],
  ) => void
  updateImageDraft: <K extends keyof TaskAgentDraft["image_config"]>(
    key: K,
    value: TaskAgentDraft["image_config"][K],
  ) => void
  handleTaskAgentModelChange: (value: string) => void
}

export function ImageTaskAgentEditor({
  t,
  draft,
  parsedImageExtraParamsError,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  isLoadingModels,
  modelGroups,
  updateDraft,
  updateImageDraft,
  handleTaskAgentModelChange,
}: ImageTaskAgentEditorProps) {
  return (
    <div className="space-y-20">
      {/* Configuration Metadata */}
      <section className="grid grid-cols-2 gap-16">
        <div className="space-y-10">
          <div className="space-y-4">
             <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.ui.neuralEngine")}</label>
             <TaskAgentModelPickerField
                t={t}
                taskAgentModelSelectValue={taskAgentModelSelectValue}
                selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                isLoadingModels={isLoadingModels}
                modelGroups={modelGroups}
                onValueChange={handleTaskAgentModelChange}
              />
          </div>

          <div className="space-y-4">
            <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.ui.globalFlags")}</label>
            <div className="space-y-6">
              {(
                [
                  { label: t("editor.fields.preferredForImageGeneration"), checked: draft.preferred_for_image_generation, key: "preferred_for_image_generation" },
                  { label: t("editor.fields.discoverable"), checked: draft.discoverable, key: "discoverable" },
                  { label: t("editor.fields.isEnabled"), checked: draft.is_enabled, key: "is_enabled" },
                ] as { label: string; checked: boolean; key: "preferred_for_image_generation" | "discoverable" | "is_enabled" }[]
              ).map((flag) => (
                <div key={flag.key} className="flex items-center justify-between gap-4">
                  <span className="text-[11px] font-bold tracking-widest text-[var(--ink-2)] uppercase">{flag.label}</span>
                  <Switch
                    checked={flag.checked}
                    onCheckedChange={(checked) => updateDraft(flag.key, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.fields.description")}</label>
          <textarea
            value={draft.description}
            onChange={(event) => updateDraft("description", event.target.value)}
            rows={4}
            placeholder={t("editor.placeholders.description")}
            className="w-full bg-transparent border-b border-[var(--hairline-strong)] py-1 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-4)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors resize-none"
          />
        </div>
      </section>

      <div className="h-px bg-[var(--hairline-strong)] opacity-10" />

      {/* Generation Parameters */}
      <section className="space-y-12">
        <div className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--ink)] uppercase">{t("editor.imageConfig.title")}</div>
        
        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">{t("editor.imageConfig.fields.negativePrompt")}</label>
          <textarea
            value={draft.image_config.negative_prompt}
            onChange={(event) => updateImageDraft("negative_prompt", event.target.value)}
            rows={3}
            placeholder={t("editor.imageConfig.placeholders.negativePrompt")}
            className="w-full bg-transparent border-b border-[var(--hairline-strong)] py-1 text-[13px] font-mono text-[var(--ink-3)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors resize-none"
          />
        </div>

        <div className="grid grid-cols-4 gap-x-12 gap-y-10">
          {(
            [
              { label: t("editor.imageConfig.fields.aspectRatio"), value: draft.image_config.aspect_ratio, key: "aspect_ratio", placeholder: t("editor.imageConfig.placeholders.aspectRatio") },
              { label: t("editor.imageConfig.fields.numOutputs"), value: draft.image_config.num_outputs, key: "num_outputs", placeholder: t("editor.imageConfig.placeholders.numOutputs") },
              { label: t("editor.imageConfig.fields.steps"), value: draft.image_config.steps, key: "steps", placeholder: t("editor.imageConfig.placeholders.steps") },
              { label: t("editor.imageConfig.fields.cfgScale"), value: draft.image_config.cfg_scale, key: "cfg_scale", placeholder: t("editor.imageConfig.placeholders.cfgScale") },
              { label: t("editor.imageConfig.fields.width"), value: draft.image_config.width, key: "width", placeholder: t("editor.imageConfig.placeholders.width") },
              { label: t("editor.imageConfig.fields.height"), value: draft.image_config.height, key: "height", placeholder: t("editor.imageConfig.placeholders.height") },
              { label: t("editor.imageConfig.fields.seed"), value: draft.image_config.seed, key: "seed", placeholder: t("editor.imageConfig.placeholders.seed") },
              { label: t("editor.imageConfig.fields.quality"), value: draft.image_config.quality, key: "quality", placeholder: t("editor.imageConfig.placeholders.quality") },
            ] as { label: string; value: string; key: "aspect_ratio" | "num_outputs" | "steps" | "cfg_scale" | "width" | "height" | "seed" | "quality"; placeholder: string }[]
          ).map((field) => (
            <div key={field.key} className="space-y-2">
              <label className="font-mono text-[8px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">{field.label}</label>
              <input
                value={field.value}
                onChange={(event) => updateImageDraft(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-transparent border-b border-[var(--hairline-subtle)] py-1 text-[11px] font-mono text-[var(--ink)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.imageConfig.fields.extraParamsJson")}</label>
          <textarea
            value={draft.image_config.extra_params_json}
            onChange={(event) => updateImageDraft("extra_params_json", event.target.value)}
            rows={4}
            placeholder="{}"
            className="w-full bg-[var(--panel-bg-inset)]/40 p-6 border border-[var(--hairline-strong)] font-mono text-[10px] text-[var(--ink-3)] focus:bg-[var(--window-bg)] focus:border-[var(--accent-strong)] transition-all outline-none"
          />
          {parsedImageExtraParamsError && (
            <p className="font-mono text-[9px] text-[var(--danger)] uppercase">{parsedImageExtraParamsError}</p>
          )}
        </div>
      </section>
    </div>
  )
}
