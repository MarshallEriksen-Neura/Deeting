"use client"

import type { ModelGroup } from "@/lib/api/models"
import { Badge } from "@/components/ui/shadcn/badge"
import { Input } from "@/components/ui/shadcn/input"
import { Label } from "@/components/ui/shadcn/label"
import { Separator } from "@/components/ui/shadcn/separator"
import { Switch } from "@/components/ui/shadcn/switch"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { TaskAgentSectionHeader } from "./task-agent-section-header"
import { TaskAgentModelPickerField } from "./task-agent-model-picker-field"
import type {
  DraftPayload,
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

type Translation = (key: string, values?: Record<string, string | number>) => string

type ImageTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  previewDraft: PreviewDraft
  draftPayload: DraftPayload
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
  previewDraft,
  draftPayload,
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
             <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">Neural Engine</label>
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
            <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">Global Flags</label>
            <div className="space-y-6">
              {[
                { label: t("editor.fields.preferredForImageGeneration"), checked: draft.preferred_for_image_generation, key: "preferred_for_image_generation" },
                { label: t("editor.fields.discoverable"), checked: draft.discoverable, key: "discoverable" },
                { label: t("editor.fields.isEnabled"), checked: draft.is_enabled, key: "is_enabled" },
              ].map(flag => (
                <div key={flag.key} className="flex items-center justify-between gap-4">
                  <span className="text-[11px] font-bold tracking-widest text-[var(--ink-2)] uppercase">{flag.label}</span>
                  <Switch
                    checked={flag.checked}
                    onCheckedChange={(checked) => updateDraft(flag.key as any, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">Description</label>
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
        <div className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--ink)] uppercase">Vision parameters</div>
        
        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">Negative Instruction Set</label>
          <textarea
            value={draft.image_config.negative_prompt}
            onChange={(event) => updateImageDraft("negative_prompt", event.target.value)}
            rows={3}
            placeholder={t("editor.imageConfig.placeholders.negativePrompt")}
            className="w-full bg-transparent border-b border-[var(--hairline-strong)] py-1 text-[13px] font-mono text-[var(--ink-3)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors resize-none"
          />
        </div>

        <div className="grid grid-cols-4 gap-x-12 gap-y-10">
          {[
            { label: "Aspect Ratio", value: draft.image_config.aspect_ratio, key: "aspect_ratio", placeholder: "1:1" },
            { label: "Num Outputs", value: draft.image_config.num_outputs, key: "num_outputs", placeholder: "1" },
            { label: "Inf. Steps", value: draft.image_config.steps, key: "steps", placeholder: "30" },
            { label: "CFG Scale", value: draft.image_config.cfg_scale, key: "cfg_scale", placeholder: "7.5" },
            { label: "Width", value: draft.image_config.width, key: "width", placeholder: "1024" },
            { label: "Height", value: draft.image_config.height, key: "height", placeholder: "1024" },
            { label: "Seed", value: draft.image_config.seed, key: "seed", placeholder: "-1" },
            { label: "Quality", value: draft.image_config.quality, key: "quality", placeholder: "standard" },
          ].map(field => (
            <div key={field.key} className="space-y-2">
              <label className="font-mono text-[8px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">{field.label}</label>
              <input
                value={field.value}
                onChange={(event) => updateImageDraft(field.key as any, event.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-transparent border-b border-[var(--hairline-subtle)] py-1 text-[11px] font-mono text-[var(--ink)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">Advanced Parameters (JSON)</label>
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
