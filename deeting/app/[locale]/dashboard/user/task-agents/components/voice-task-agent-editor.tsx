"use client"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TaskAgentSectionHeader } from "./task-agent-section-header"
import type {
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

const DEFAULT_TASK_AGENT_MODEL_VALUE = "__task_agent_model_default__"

type Translation = (key: string, values?: Record<string, string | number>) => string

type VoiceTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  parsedModelConfigError: string | null
  parsedVoiceExtraParamsError: string | null
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  unknownTaskAgentModelValue: string | null
  isLoadingModels: boolean
  modelGroups: Array<{
    instance_id: string
    instance_name: string
    provider?: string | null
    models: Array<{
      id: string
      provider_model_id?: string | null
      owned_by?: string | null
    }>
  }>
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
  parsedModelConfigError,
  parsedVoiceExtraParamsError,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  unknownTaskAgentModelValue,
  isLoadingModels,
  modelGroups,
  updateDraft,
  updateVoiceDraft,
  handleTaskAgentModelChange,
}: VoiceTaskAgentEditorProps) {
  return (
    <TabsContent value="config" className="space-y-6">
      <TaskAgentSectionHeader
        title={t("editor.basic.title")}
        description={t("editor.basic.description")}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="task-agent-name">{t("editor.fields.name")}</Label>
          <Input
            id="task-agent-name"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder={t("editor.placeholders.name")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-agent-kind">{t("editor.fields.invocationKind")}</Label>
          <div
            id="task-agent-kind"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--foreground)]">
                {t("badges.textToSpeech")}
              </span>
              <Badge variant="secondary">{t("editor.values.typeLocked")}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-agent-description">{t("editor.fields.description")}</Label>
        <Textarea
          id="task-agent-description"
          value={draft.description}
          onChange={(event) => updateDraft("description", event.target.value)}
          rows={3}
          placeholder={t("editor.placeholders.description")}
        />
      </div>

      <Separator />

      <TaskAgentSectionHeader
        title={t("editor.model.title")}
        description={t("editor.model.description")}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="task-agent-model">{t("editor.fields.model")}</Label>
          <Select
            value={taskAgentModelSelectValue}
            onValueChange={handleTaskAgentModelChange}
            disabled={isLoadingModels}
          >
            <SelectTrigger id="task-agent-model">
              <SelectValue placeholder={t("editor.placeholders.model")}>
                {selectedTaskAgentModelOption ? (
                  <span className="truncate">{selectedTaskAgentModelOption.modelId}</span>
                ) : unknownTaskAgentModelLabel ? (
                  <span className="truncate">{unknownTaskAgentModelLabel}</span>
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_TASK_AGENT_MODEL_VALUE}>
                {t("editor.placeholders.model")}
              </SelectItem>
              {unknownTaskAgentModelValue ? (
                <SelectItem value={unknownTaskAgentModelValue}>
                  {unknownTaskAgentModelLabel}
                </SelectItem>
              ) : null}
              {modelGroups.map((group) => (
                <SelectGroup key={group.instance_id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.instance_name}
                  </SelectLabel>
                  {group.models.map((model) => {
                    const optionValue = `${group.instance_id}::${model.provider_model_id ?? model.id}`
                    return (
                      <SelectItem key={optionValue} value={optionValue}>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground">{model.id}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.provider || model.owned_by || "provider"}
                          </span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-agent-provider-model-id">
            {t("editor.fields.providerModelId")}
          </Label>
          <Input
            id="task-agent-provider-model-id"
            value={draft.provider_model_id}
            onChange={(event) => updateDraft("provider_model_id", event.target.value)}
            placeholder={t("editor.placeholders.providerModelId")}
          />
        </div>
      </div>

      <Separator />

      <TaskAgentSectionHeader
        title={t("editor.voiceConfig.title")}
        description={t("editor.voiceConfig.description")}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="task-agent-voice-voice">{t("editor.voiceConfig.fields.voice")}</Label>
          <Input
            id="task-agent-voice-voice"
            value={draft.voice_config.voice}
            onChange={(event) => updateVoiceDraft("voice", event.target.value)}
            placeholder={t("editor.voiceConfig.placeholders.voice")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-agent-voice-response-format">
            {t("editor.voiceConfig.fields.responseFormat")}
          </Label>
          <Input
            id="task-agent-voice-response-format"
            value={draft.voice_config.response_format}
            onChange={(event) => updateVoiceDraft("response_format", event.target.value)}
            placeholder={t("editor.voiceConfig.placeholders.responseFormat")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-agent-voice-speed">{t("editor.voiceConfig.fields.speed")}</Label>
          <Input
            id="task-agent-voice-speed"
            value={draft.voice_config.speed}
            onChange={(event) => updateVoiceDraft("speed", event.target.value)}
            placeholder={t("editor.voiceConfig.placeholders.speed")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-agent-voice-extra-params">
          {t("editor.voiceConfig.fields.extraParamsJson")}
        </Label>
        <Textarea
          id="task-agent-voice-extra-params"
          value={draft.voice_config.extra_params_json}
          onChange={(event) => updateVoiceDraft("extra_params_json", event.target.value)}
          rows={6}
          placeholder={t.raw?.("editor.voiceConfig.placeholders.extraParamsJson") ?? ""}
          className="font-mono text-xs"
        />
        <p className="text-xs text-[var(--muted)]">{t("editor.voiceConfig.helper")}</p>
        {parsedVoiceExtraParamsError ? (
          <p className="text-xs text-red-300">{parsedVoiceExtraParamsError}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-agent-model-config">{t("editor.fields.modelConfigJson")}</Label>
        <Textarea
          id="task-agent-model-config"
          value={draft.model_config_json}
          onChange={(event) => updateDraft("model_config_json", event.target.value)}
          rows={8}
          placeholder={t.raw?.("editor.placeholders.modelConfigJson") ?? ""}
          className="font-mono text-xs"
        />
        <p className="text-xs text-[var(--muted)]">{t("editor.modelConfig.helper")}</p>
        {parsedModelConfigError ? (
          <p className="text-xs text-red-300">{parsedModelConfigError}</p>
        ) : null}
      </div>
    </TabsContent>
  )
}
