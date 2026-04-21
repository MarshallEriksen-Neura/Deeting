"use client"

import {
  Search,
} from "lucide-react"

import type { ModelGroup } from "@/lib/api/models"
import type { LocalAsset } from "@/lib/api/local-assets"
import { Badge } from "@/components/ui/shadcn/badge"
import { Button } from "@/components/ui/shadcn/button"
import { Checkbox } from "@/components/ui/shadcn/checkbox"
import { Input } from "@/components/ui/shadcn/input"
import { Label } from "@/components/ui/shadcn/label"
import { ScrollArea } from "@/components/ui/shadcn/scroll-area"
import { Separator } from "@/components/ui/shadcn/separator"
import { Skeleton } from "@/components/ui/shadcn/skeleton"
import { Switch } from "@/components/ui/shadcn/switch"
import { TabsContent } from "@/components/ui/shadcn/tabs"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { cn } from "@/lib/utils"
import type { CustomTaskAgentBindingCatalog } from "@/lib/api/custom-task-agents"
import { TaskAgentSectionHeader } from "./task-agent-section-header"
import { TaskAgentModelPickerField } from "./task-agent-model-picker-field"
import type {
  DraftPayload,
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

function statusToneClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    case "starting":
    case "pending":
    case "updating":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200"
    case "degraded":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200"
    case "error":
    case "crashed":
    case "orphaned":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    default:
      return "border-white/10 bg-white/5 text-[var(--muted)]"
  }
}

type Translation = (key: string, values?: Record<string, string | number>) => string

type ChatTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  draft: TaskAgentDraft
  previewDraft: PreviewDraft
  draftPayload: DraftPayload
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  bindingCatalog: CustomTaskAgentBindingCatalog
  bindingsLoading: boolean
  localAssets: LocalAsset[]
  assetsLoading: boolean
  filteredBindingTools: CustomTaskAgentBindingCatalog["mcp_tools"]
  filteredBindingSkills: CustomTaskAgentBindingCatalog["guidance_skills"]
  toolQuery: string
  skillQuery: string
  showSelectedToolsOnly: boolean
  showSelectedSkillsOnly: boolean
  updateDraft: <K extends keyof TaskAgentDraft>(
    key: K,
    value: TaskAgentDraft[K],
  ) => void
  handleTaskAgentModelChange: (value: string) => void
  setToolQuery: (value: string) => void
  setSkillQuery: (value: string) => void
  setShowSelectedToolsOnly: (updater: (current: boolean) => boolean) => void
  setShowSelectedSkillsOnly: (updater: (current: boolean) => boolean) => void
  toggleBinding: (kind: "tool" | "skill", identifier: string, checked: boolean) => void
}

function RequiredFieldLabel({
  htmlFor,
  label,
}: {
  htmlFor: string
  label: string
}) {
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-1">
      <span>{label}</span>
      <span className="text-red-400" aria-hidden="true">
        *
      </span>
    </Label>
  )
}

export function ChatTaskAgentEditor({
  t,
  draft,
  previewDraft,
  draftPayload,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  isLoadingModels,
  modelGroups,
  bindingCatalog,
  bindingsLoading,
  localAssets,
  assetsLoading,
  filteredBindingTools,
  filteredBindingSkills,
  toolQuery,
  skillQuery,
  showSelectedToolsOnly,
  showSelectedSkillsOnly,
  updateDraft,
  handleTaskAgentModelChange,
  setToolQuery,
  setSkillQuery,
  setShowSelectedToolsOnly,
  setShowSelectedSkillsOnly,
  toggleBinding,
}: ChatTaskAgentEditorProps) {
  const bindableAssets = localAssets.filter(
    (asset) => asset.asset_kind === "html_asset" && !asset.is_archived,
  )
  return (
    <>
      <TabsContent value="config" className="space-y-6">
        <TaskAgentSectionHeader
          title={t("editor.basic.title")}
          description={t("editor.basic.description")}
        />
        <p className="text-xs text-[var(--muted)]">
          <span className="mr-1 text-red-400" aria-hidden="true">
            *
          </span>
          {t("editor.requiredHint")}
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <RequiredFieldLabel
              htmlFor="task-agent-name"
              label={t("editor.fields.name")}
            />
            <Input
              id="task-agent-name"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder={t("editor.placeholders.name")}
              required
              aria-required="true"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-agent-kind">{t("editor.fields.invocationKind")}</Label>
            <div
              id="task-agent-kind"
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--foreground)]">{t("badges.chat")}</span>
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

        <div className="space-y-2">
          <RequiredFieldLabel
            htmlFor="task-agent-prompt"
            label={t("editor.fields.taskPrompt")}
          />
          <Textarea
            id="task-agent-prompt"
            value={draft.task_prompt}
            onChange={(event) => updateDraft("task_prompt", event.target.value)}
            rows={8}
            placeholder={t("editor.placeholders.taskPrompt")}
            required
            aria-required="true"
          />
        </div>

        <Separator />

        <TaskAgentSectionHeader
          title={t("editor.model.title")}
        />

        <div className="grid gap-5">
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

      <TabsContent value="bindings" className="space-y-6">
        <TaskAgentSectionHeader
          title={t("bindings.title")}
          description={t("bindings.description")}
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium text-[var(--foreground)]">{t("bindings.assetTitle")}</p>
              <p className="text-sm text-[var(--muted)]">{t("bindings.assetDescription")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{draft.bound_asset_id ? 1 : 0}</Badge>
              {draft.bound_asset_id ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateDraft("bound_asset_id", "")}
                >
                  {t("bindings.clearAsset")}
                </Button>
              ) : null}
            </div>
          </div>
          <ScrollArea className="h-[240px] pr-4">
            <div className="space-y-3">
              {assetsLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`asset-skeleton-${index}`}
                    className="space-y-2 rounded-xl border border-white/10 p-3"
                  >
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))
              ) : bindableAssets.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{t("bindings.noAssets")}</p>
              ) : (
                bindableAssets.map((asset) => {
                    const isSelected = draft.bound_asset_id === asset.asset_id
                    return (
                      <button
                        key={asset.asset_id}
                        type="button"
                        onClick={() =>
                          updateDraft("bound_asset_id", isSelected ? "" : asset.asset_id)
                        }
                        className={cn(
                          "w-full rounded-xl border p-3 text-left transition-colors",
                          isSelected
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/10 bg-transparent hover:bg-white/[0.03]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--foreground)]">
                                {asset.title}
                              </span>
                              {isSelected ? (
                                <Badge variant="secondary">{t("bindings.assetBound")}</Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-[var(--muted)]">
                              {asset.summary || asset.render_hint || asset.asset_id}
                            </p>
                            <p className="text-xs text-[var(--muted)]">
                              {asset.asset_id}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })
              )}
            </div>
          </ScrollArea>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-[var(--foreground)]">{t("bindings.toolsTitle")}</p>
                <p className="text-sm text-[var(--muted)]">{t("bindings.toolsDescription")}</p>
              </div>
              <Badge variant="secondary">{draft.callable_mcp_tool_ids.length}</Badge>
            </div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder={t("bindings.searchToolsPlaceholder")}
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant={showSelectedToolsOnly ? "default" : "outline"}
                onClick={() => setShowSelectedToolsOnly((current) => !current)}
              >
                {t("bindings.selectedOnly")}
              </Button>
            </div>
            <ScrollArea className="h-[320px] pr-4">
              <div className="space-y-3">
                {bindingsLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`tool-skeleton-${index}`}
                      className="space-y-2 rounded-xl border border-white/10 p-3"
                    >
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))
                ) : bindingCatalog.mcp_tools.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t("bindings.noTools")}</p>
                ) : filteredBindingTools.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t("bindings.noFilteredTools")}</p>
                ) : (
                  (() => {
                    const groups = new Map<string, typeof filteredBindingTools>()
                    for (const tool of filteredBindingTools) {
                      const key = tool.server_name || t("bindings.unknownServer")
                      const list = groups.get(key)
                      if (list) list.push(tool)
                      else groups.set(key, [tool])
                    }
                    return Array.from(groups.entries()).map(([serverName, tools]) => (
                      <div key={serverName} className="space-y-2">
                        <p className="sticky top-0 z-10 bg-white/[0.03] px-1 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                          {serverName}
                          <span className="ml-1.5 text-[11px] font-normal tabular-nums opacity-60">
                            ({tools.length})
                          </span>
                        </p>
                        {tools.map((tool) => (
                          <label
                            key={tool.id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3 transition-colors hover:bg-white/[0.03]"
                          >
                            <Checkbox
                              checked={draft.callable_mcp_tool_ids.includes(tool.id)}
                              onCheckedChange={(checked) =>
                                toggleBinding("tool", tool.id, checked === true)
                              }
                              className="mt-0.5"
                            />
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-[var(--foreground)]">
                                  {tool.name}
                                </span>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px]",
                                    statusToneClass(tool.status),
                                  )}
                                >
                                  {tool.status}
                                </span>
                              </div>
                              <p className="text-sm text-[var(--muted)]">{tool.description || "-"}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    ))
                  })()
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-[var(--foreground)]">{t("bindings.skillsTitle")}</p>
                <p className="text-sm text-[var(--muted)]">{t("bindings.skillsDescription")}</p>
              </div>
              <Badge variant="secondary">{draft.guidance_skill_ids.length}</Badge>
            </div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder={t("bindings.searchSkillsPlaceholder")}
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant={showSelectedSkillsOnly ? "default" : "outline"}
                onClick={() => setShowSelectedSkillsOnly((current) => !current)}
              >
                {t("bindings.selectedOnly")}
              </Button>
            </div>
            <ScrollArea className="h-[320px] pr-4">
              <div className="space-y-3">
                {bindingsLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`skill-skeleton-${index}`}
                      className="space-y-2 rounded-xl border border-white/10 p-3"
                    >
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-5/6" />
                    </div>
                  ))
                ) : bindingCatalog.guidance_skills.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t("bindings.noSkills")}</p>
                ) : filteredBindingSkills.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{t("bindings.noFilteredSkills")}</p>
                ) : (
                  filteredBindingSkills.map((skill) => (
                    <label
                      key={skill.skill_id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <Checkbox
                        checked={draft.guidance_skill_ids.includes(skill.skill_id)}
                        onCheckedChange={(checked) =>
                          toggleBinding("skill", skill.skill_id, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--foreground)]">
                            {skill.skill_id}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px]",
                              skill.is_enabled
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : "border-white/10 bg-white/5 text-[var(--muted)]",
                            )}
                          >
                            {skill.is_enabled ? t("badges.enabled") : t("badges.disabled")}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--muted)]">
                          {t("bindings.skillMeta", {
                            version: skill.installed_version ?? t("bindings.unknownVersion"),
                            runtime: skill.runtime ?? t("bindings.unknownRuntime"),
                          })}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="debug" className="space-y-6">
        <TaskAgentSectionHeader title={t("debug.title")} description={t("debug.description")} />
        <div className="grid gap-4 lg:grid-cols-3">
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
                <dt className="text-[var(--muted)]">{t("editor.fields.invocationKind")}</dt>
                <dd className="text-right text-[var(--foreground)]">{t("badges.chat")}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {t("debug.cards.bindings")}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.boundTools")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.callable_mcp_tool_ids.length}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.boundSkills")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.guidance_skill_ids.length}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.boundAsset")}</dt>
                <dd className="max-w-[180px] text-right text-[var(--foreground)]">
                  {draft.bound_asset_id || "none"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">
                  {t("editor.fields.preferredForImageGeneration")}
                </dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.preferred_for_image_generation
                    ? t("editor.values.preferredForImageGenerationOn")
                    : t("editor.values.preferredForImageGenerationOff")}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("editor.fields.discoverable")}</dt>
                <dd className="text-right text-[var(--foreground)]">
                  {draft.discoverable ? t("badges.discoverable") : t("badges.hidden")}
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
