"use client"

import { Checkbox } from "@/components/ui/shadcn/checkbox"
import { Skeleton } from "@/components/ui/shadcn/skeleton"
import { cn } from "@/lib/utils"
import type { CustomTaskAgentBindingCatalog } from "@/lib/api/custom-task-agents"
import type { TaskAgentDraft } from "../task-agent-editor-types"
import { BindingPanel } from "./binding-panel"
import { BindingSearchBar } from "./binding-search-bar"

type Translation = (key: string, values?: Record<string, string | number>) => string
type SkillList = CustomTaskAgentBindingCatalog["guidance_skills"]

type ChatSkillBindingsProps = {
  t: Translation
  draft: TaskAgentDraft
  bindingCatalog: CustomTaskAgentBindingCatalog
  bindingsLoading: boolean
  filteredBindingSkills: SkillList
  skillQuery: string
  showSelectedSkillsOnly: boolean
  setSkillQuery: (value: string) => void
  setShowSelectedSkillsOnly: (updater: (current: boolean) => boolean) => void
  toggleBinding: (kind: "tool" | "skill", identifier: string, checked: boolean) => void
}

export function ChatSkillBindings({
  t,
  draft,
  bindingCatalog,
  bindingsLoading,
  filteredBindingSkills,
  skillQuery,
  showSelectedSkillsOnly,
  setSkillQuery,
  setShowSelectedSkillsOnly,
  toggleBinding,
}: ChatSkillBindingsProps) {
  return (
    <BindingPanel
      title={t("bindings.skillsTitle")}
      description={t("bindings.skillsDescription")}
      count={draft.guidance_skill_ids.length}
      toolbar={
        <BindingSearchBar
          value={skillQuery}
          onChange={setSkillQuery}
          placeholder={t("bindings.searchSkillsPlaceholder")}
          showSelectedOnly={showSelectedSkillsOnly}
          onToggleSelectedOnly={() =>
            setShowSelectedSkillsOnly((current) => !current)
          }
          selectedOnlyLabel={t("bindings.selectedOnly")}
        />
      }
    >
      <div className="space-y-2">
        {bindingsLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`skill-skeleton-${index}`}
              className="space-y-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)]/40 p-3"
            >
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))
        ) : bindingCatalog.guidance_skills.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            {t("bindings.noSkills")}
          </p>
        ) : filteredBindingSkills.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            {t("bindings.noFilteredSkills")}
          </p>
        ) : (
          filteredBindingSkills.map((skill) => {
            const isChecked = draft.guidance_skill_ids.includes(skill.skill_id)
            return (
              <label
                key={skill.skill_id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all",
                  isChecked
                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)]/60"
                    : "border-[var(--hairline)] bg-[var(--panel-bg)]/40 hover:bg-[var(--panel-bg)]/70",
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={(checked) =>
                    toggleBinding("skill", skill.skill_id, checked === true)
                  }
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ws-control text-sm font-bold text-[var(--ink-1)]">
                      {skill.skill_id}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        skill.is_enabled
                          ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"
                          : "border-[var(--hairline)] bg-[var(--panel-bg-inset)]/60 text-[var(--ink-3)]",
                      )}
                    >
                      {skill.is_enabled ? t("badges.enabled") : t("badges.disabled")}
                    </span>
                  </div>
                  <p className="ws-caption text-[11px] opacity-60 leading-snug">
                    {t("bindings.skillMeta", {
                      version: skill.installed_version ?? t("bindings.unknownVersion"),
                      runtime: skill.runtime ?? t("bindings.unknownRuntime"),
                    })}
                  </p>
                </div>
              </label>
            )
          })
        )}
      </div>
    </BindingPanel>
  )
}
