"use client"

import type { ModelGroup } from "@/lib/api/models"
import { Switch } from "@/components/ui/shadcn/switch"
import { TaskAgentModelPickerField } from "./task-agent-model-picker-field"
import type {
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

type Translation = (key: string, values?: Record<string, string | number>) => string

type VoiceTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  parsedVoiceExtraParamsError: string | null
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  updateDraft: <K extends keyof TaskAgentDraft>(
    key: K,
    value: TaskAgentDraft[K],
  ) => void
  updateVoiceDraft: <K extends keyof TaskAgentDraft["voice_config"]>(
    key: K,
    value: TaskAgentDraft["voice_config"][K],
  ) => void
  handleTaskAgentModelChange: (value: string) => void
}

export function VoiceTaskAgentEditor({
  t,
  draft,
  parsedVoiceExtraParamsError,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  isLoadingModels,
  modelGroups,
  updateDraft,
  updateVoiceDraft,
  handleTaskAgentModelChange,
}: VoiceTaskAgentEditorProps) {
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
            <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.ui.visibilityFlags")}</label>
            <div className="space-y-6">
              {(
                [
                  { label: t("editor.fields.discoverable"), checked: draft.discoverable, key: "discoverable" },
                  { label: t("editor.fields.isEnabled"), checked: draft.is_enabled, key: "is_enabled" },
                ] as { label: string; checked: boolean; key: "discoverable" | "is_enabled" }[]
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

      {/* Acoustic Parameters */}
      <section className="space-y-12">
        <div className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--ink)] uppercase">{t("editor.voiceConfig.title")}</div>
        
        <div className="grid grid-cols-3 gap-12">
          {(
            [
              { label: t("editor.voiceConfig.fields.voice"), value: draft.voice_config.voice, key: "voice", placeholder: t("editor.voiceConfig.placeholders.voice") },
              { label: t("editor.voiceConfig.fields.responseFormat"), value: draft.voice_config.response_format, key: "response_format", placeholder: t("editor.voiceConfig.placeholders.responseFormat") },
              { label: t("editor.voiceConfig.fields.speed"), value: draft.voice_config.speed, key: "speed", placeholder: t("editor.voiceConfig.placeholders.speed") },
            ] as { label: string; value: string; key: "voice" | "response_format" | "speed"; placeholder: string }[]
          ).map((field) => (
            <div key={field.key} className="space-y-2">
              <label className="font-mono text-[8px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">{field.label}</label>
              <input
                value={field.value}
                onChange={(event) => updateVoiceDraft(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-transparent border-b border-[var(--hairline-subtle)] py-1 text-[11px] font-mono text-[var(--ink)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("editor.voiceConfig.fields.extraParamsJson")}</label>
          <textarea
            value={draft.voice_config.extra_params_json}
            onChange={(event) => updateVoiceDraft("extra_params_json", event.target.value)}
            rows={4}
            placeholder="{}"
            className="w-full bg-[var(--panel-bg-inset)]/40 p-6 border border-[var(--hairline-strong)] font-mono text-[10px] text-[var(--ink-3)] focus:bg-[var(--window-bg)] focus:border-[var(--accent-strong)] transition-all outline-none"
          />
          {parsedVoiceExtraParamsError && (
            <p className="font-mono text-[9px] text-[var(--danger)] uppercase">{parsedVoiceExtraParamsError}</p>
          )}
        </div>
      </section>
    </div>
  )
}
