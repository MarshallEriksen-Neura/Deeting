"use client"

import type { ModelGroup } from "@/lib/api/models"
import type { CustomTaskAgentBindingCatalog } from "@/lib/api/custom-task-agents"
import { AlertTriangle } from "lucide-react"

import { buildTaskAgentCapabilityHealth, buildTaskAgentBindingRecommendations } from "./task-agents-helpers"
import { AgentCanvas } from "./chat-editor/agent-canvas"
import { ChatToolBindings } from "./chat-editor/chat-tool-bindings"
import { ChatSkillBindings } from "./chat-editor/chat-skill-bindings"
import { ChatDebugTab } from "./chat-editor/chat-debug-tab"
import type {
  DraftPayload,
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"

type Translation = (key: string, values?: Record<string, string | number>) => string

type ChatTaskAgentEditorProps = {
  t: Translation & { raw?: (key: string) => string }
  activeTab: string
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
  applyRecommendedBindings: () => void
}

export function ChatTaskAgentEditor({
  t,
  activeTab,
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
  applyRecommendedBindings,
}: ChatTaskAgentEditorProps) {
  const capabilityHealth = buildTaskAgentCapabilityHealth(draft)
  const recommendations = buildTaskAgentBindingRecommendations(draft, bindingCatalog)
  const hasRecommendations =
    recommendations.recommendedToolIds.length > 0 || recommendations.recommendedSkillIds.length > 0

  if (activeTab === "config") {
    return (
      <AgentCanvas
        t={t}
        draft={draft}
        taskAgentModelSelectValue={taskAgentModelSelectValue}
        selectedTaskAgentModelOption={selectedTaskAgentModelOption}
        unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
        isLoadingModels={isLoadingModels}
        modelGroups={modelGroups}
        updateDraft={updateDraft}
        handleTaskAgentModelChange={handleTaskAgentModelChange}
      />
    )
  }

  if (activeTab === "bindings") {
    return (
      <div className="space-y-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <section className="space-y-4">
          <div className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--ink)] uppercase">
            {t("bindings.title")}
          </div>
          <p className="text-[13px] text-[var(--ink-4)] leading-relaxed max-w-2xl">
            {t("bindings.description")}
          </p>
          {capabilityHealth.isGuidanceOnly ? (
            <div className="flex items-start gap-3 rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-soft)]/70 px-4 py-3 text-[12px] leading-relaxed text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 size-4 flex-none" />
              <div className="space-y-1">
                <p className="font-semibold text-[var(--ink)]">
                  {t("bindings.guidanceOnlyWarningTitle")}
                </p>
                <p>{t("bindings.guidanceOnlyWarningDescription")}</p>
              </div>
            </div>
          ) : null}
          {hasRecommendations ? (
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/50 px-4 py-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
              <div className="space-y-1">
                <p className="font-semibold text-[var(--ink)]">
                  {t("bindings.recommendationTitle")}
                </p>
                <p>
                  {t("bindings.recommendationDescription", {
                    tools: recommendations.recommendedToolIds.length,
                    skills: recommendations.recommendedSkillIds.length,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={applyRecommendedBindings}
                className="shrink-0 rounded-full border border-[var(--accent-border)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-strong)] transition hover:bg-[var(--accent-soft)]"
              >
                {t("bindings.applyRecommendations")}
              </button>
            </div>
          ) : null}
        </section>

        <div className="grid gap-16 xl:grid-cols-2">
          <ChatToolBindings
            t={t}
            draft={draft}
            bindingCatalog={bindingCatalog}
            bindingsLoading={bindingsLoading}
            filteredBindingTools={filteredBindingTools}
            toolQuery={toolQuery}
            showSelectedToolsOnly={showSelectedToolsOnly}
            setToolQuery={setToolQuery}
            setShowSelectedToolsOnly={setShowSelectedToolsOnly}
            toggleBinding={toggleBinding}
          />
          <ChatSkillBindings
            t={t}
            draft={draft}
            bindingCatalog={bindingCatalog}
            bindingsLoading={bindingsLoading}
            filteredBindingSkills={filteredBindingSkills}
            skillQuery={skillQuery}
            showSelectedSkillsOnly={showSelectedSkillsOnly}
            setSkillQuery={setSkillQuery}
            setShowSelectedSkillsOnly={setShowSelectedSkillsOnly}
            toggleBinding={toggleBinding}
          />
        </div>
      </div>
    )
  }

  if (activeTab === "debug") {
    return (
      <ChatDebugTab
        t={t}
        draft={draft}
        previewDraft={previewDraft}
        draftPayload={draftPayload}
      />
    )
  }

  return null
}
