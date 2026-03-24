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
import { Switch } from "@/components/ui/switch"
import { TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TaskAgentSectionHeader } from "./task-agent-section-header"
import type {
  DraftPayload,
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

const DEFAULT_TASK_AGENT_MODEL_VALUE = "__task_agent_model_default__"

type Translation = (key: string, values?: Record<string, string | number>) => string

type ImageTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  previewDraft: PreviewDraft
  draftPayload: DraftPayload
  parsedModelConfigError: string | null
  parsedImageExtraParamsError: string | null
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
  parsedModelConfigError,
  parsedImageExtraParamsError,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  unknownTaskAgentModelValue,
  isLoadingModels,
  modelGroups,
  updateDraft,
  updateImageDraft,
  handleTaskAgentModelChange,
}: ImageTaskAgentEditorProps) {
  return (
    <>
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
                  {t("badges.imageGeneration")}
                </span>
                <Badge variant="secondary">{t("editor.values.typeLocked")}</Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("editor.fields.preferredForImageGeneration")}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t("editor.toggles.preferredForImageGeneration")}
              </p>
            </div>
            <Switch
              checked={draft.preferred_for_image_generation}
              onCheckedChange={(checked) =>
                updateDraft("preferred_for_image_generation", checked)
              }
            />
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
                            <span className="text-xs font-medium text-foreground">
                              {model.id}
                            </span>
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
          title={t("editor.imageConfig.title")}
          description={t("editor.imageConfig.description")}
        />
        <div className="grid gap-5 lg:grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-negative-prompt">
              {t("editor.imageConfig.fields.negativePrompt")}
            </Label>
            <Textarea
              id="task-agent-image-negative-prompt"
              value={draft.image_config.negative_prompt}
              onChange={(event) => updateImageDraft("negative_prompt", event.target.value)}
              rows={3}
              placeholder={t("editor.imageConfig.placeholders.negativePrompt")}
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="task-agent-max-input-images">
              {t("editor.imageConfig.fields.maxInputImages")}
            </Label>
            <Input
              id="task-agent-max-input-images"
              value={draft.image_config.max_input_images}
              onChange={(event) =>
                updateImageDraft("max_input_images", event.target.value)
              }
              placeholder={t("editor.imageConfig.placeholders.maxInputImages")}
            />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  {t("editor.imageConfig.fields.allowTextOnly")}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {t("editor.imageConfig.helpers.allowTextOnly")}
                </p>
              </div>
              <Switch
                checked={draft.image_config.allow_text_only}
                onCheckedChange={(checked) =>
                  updateImageDraft("allow_text_only", checked)
                }
              />
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-aspect-ratio">
              {t("editor.imageConfig.fields.aspectRatio")}
            </Label>
            <Input
              id="task-agent-image-aspect-ratio"
              value={draft.image_config.aspect_ratio}
              onChange={(event) => updateImageDraft("aspect_ratio", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.aspectRatio")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-num-outputs">
              {t("editor.imageConfig.fields.numOutputs")}
            </Label>
            <Input
              id="task-agent-image-num-outputs"
              value={draft.image_config.num_outputs}
              onChange={(event) => updateImageDraft("num_outputs", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.numOutputs")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-steps">{t("editor.imageConfig.fields.steps")}</Label>
            <Input
              id="task-agent-image-steps"
              value={draft.image_config.steps}
              onChange={(event) => updateImageDraft("steps", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.steps")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-cfg-scale">
              {t("editor.imageConfig.fields.cfgScale")}
            </Label>
            <Input
              id="task-agent-image-cfg-scale"
              value={draft.image_config.cfg_scale}
              onChange={(event) => updateImageDraft("cfg_scale", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.cfgScale")}
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-seed">{t("editor.imageConfig.fields.seed")}</Label>
            <Input
              id="task-agent-image-seed"
              value={draft.image_config.seed}
              onChange={(event) => updateImageDraft("seed", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.seed")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-response-format">
              {t("editor.imageConfig.fields.responseFormat")}
            </Label>
            <Input
              id="task-agent-image-response-format"
              value={draft.image_config.response_format}
              onChange={(event) =>
                updateImageDraft("response_format", event.target.value)
              }
              placeholder={t("editor.imageConfig.placeholders.responseFormat")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-quality">
              {t("editor.imageConfig.fields.quality")}
            </Label>
            <Input
              id="task-agent-image-quality"
              value={draft.image_config.quality}
              onChange={(event) => updateImageDraft("quality", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.quality")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-style">{t("editor.imageConfig.fields.style")}</Label>
            <Input
              id="task-agent-image-style"
              value={draft.image_config.style}
              onChange={(event) => updateImageDraft("style", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.style")}
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-width">{t("editor.imageConfig.fields.width")}</Label>
            <Input
              id="task-agent-image-width"
              value={draft.image_config.width}
              onChange={(event) => updateImageDraft("width", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.width")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-height">{t("editor.imageConfig.fields.height")}</Label>
            <Input
              id="task-agent-image-height"
              value={draft.image_config.height}
              onChange={(event) => updateImageDraft("height", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.height")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-image-sampler-name">
              {t("editor.imageConfig.fields.samplerName")}
            </Label>
            <Input
              id="task-agent-image-sampler-name"
              value={draft.image_config.sampler_name}
              onChange={(event) => updateImageDraft("sampler_name", event.target.value)}
              placeholder={t("editor.imageConfig.placeholders.samplerName")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-agent-image-extra-params">
            {t("editor.imageConfig.fields.extraParamsJson")}
          </Label>
          <Textarea
            id="task-agent-image-extra-params"
            value={draft.image_config.extra_params_json}
            onChange={(event) => updateImageDraft("extra_params_json", event.target.value)}
            rows={6}
            placeholder={t.raw?.("editor.imageConfig.placeholders.extraParamsJson") ?? ""}
            className="font-mono text-xs"
          />
          <p className="text-xs text-[var(--muted)]">{t("editor.imageConfig.helper")}</p>
          {parsedImageExtraParamsError ? (
            <p className="text-xs text-red-300">{parsedImageExtraParamsError}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-agent-model-config">
            {t("editor.fields.modelConfigJson")}
          </Label>
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

        <Separator />

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="task-agent-tags">{t("editor.fields.tags")}</Label>
            <Input
              id="task-agent-tags"
              value={draft.tags_input}
              onChange={(event) => updateDraft("tags_input", event.target.value)}
              placeholder={t("editor.placeholders.tags")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {t("editor.fields.discoverable")}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {t("editor.toggles.discoverable")}
                  </p>
                </div>
                <Switch
                  checked={draft.discoverable}
                  onCheckedChange={(checked) => updateDraft("discoverable", checked)}
                />
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {t("editor.fields.isEnabled")}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {t("editor.toggles.enabled")}
                  </p>
                </div>
                <Switch
                  checked={draft.is_enabled}
                  onCheckedChange={(checked) => updateDraft("is_enabled", checked)}
                />
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="debug" className="space-y-6">
        <TaskAgentSectionHeader title={t("debug.title")} description={t("debug.description")} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {t("debug.cards.identity")}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.model")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.model.trim() || "default"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.providerModelId")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.provider_model_id.trim() || "—"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.invocationKind")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {t("badges.imageGeneration")}
                </dd>
              </div>
            </dl>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {t("debug.cards.preview")}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("preview.fields.maxRounds")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {previewDraft.max_rounds.trim() || "default"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("preview.fields.maxTokens")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {previewDraft.max_tokens.trim() || "default"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("preview.fields.temperature")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {previewDraft.temperature.trim() || "default"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            {t("debug.rawProfile")}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
            {JSON.stringify({ payload: draftPayload }, null, 2)}
          </pre>
        </div>
      </TabsContent>
    </>
  )
}
