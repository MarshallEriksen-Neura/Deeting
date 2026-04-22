"use client"

import * as React from "react"
import { Plus, X, MessageSquare, Eye, EyeOff, Zap } from "lucide-react"
import type { ModelGroup } from "@/lib/api/models"
import { TaskAgentModelPickerField } from "../task-agent-model-picker-field"
import type {
  TaskAgentDraft,
  TaskAgentModelOption,
} from "../task-agent-editor-types"
import styles from "./agent-canvas.module.css"

type Translation = (key: string, values?: Record<string, string | number>) => string

/* ------------------------------------------------------------------ */
/*  Status pill — dot + icon + label                                   */
/* ------------------------------------------------------------------ */
function TogglePill({
  checked,
  onChange,
  onLabel,
  offLabel,
  iconOn: IconOn,
  iconOff: IconOff,
  tone,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  onLabel: string
  offLabel: string
  iconOn: React.ComponentType<{ className?: string }>
  iconOff: React.ComponentType<{ className?: string }>
  tone: "ok" | "accent"
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      data-checked={checked ? "true" : "false"}
      data-tone={tone}
      className={styles.togglePill}
    >
      <span className={styles.toggleDot} />
      {checked ? (
        <IconOn className={styles.toggleIcon} />
      ) : (
        <IconOff className={styles.toggleIcon} />
      )}
      <span>{checked ? onLabel : offLabel}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Description — inline paragraph, click to edit                      */
/* ------------------------------------------------------------------ */
function DescriptionStrip({
  t,
  value,
  onChange,
}: {
  t: Translation
  value: string
  onChange: (next: string) => void
}) {
  const [editing, setEditing] = React.useState(false)

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={t("editor.placeholders.description")}
        className={styles.descriptionTextarea}
      />
    )
  }

  if (!value.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${styles.description} ${styles.descriptionEmpty}`}
      >
        <Plus className={styles.descriptionEmptyIcon} />
        <span>{t("editor.placeholders.description")}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={styles.description}
      title={value}
    >
      {value}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Tag chips                                                          */
/* ------------------------------------------------------------------ */
function TagChips({
  t,
  value,
  onChange,
}: {
  t: Translation
  value: string
  onChange: (next: string) => void
}) {
  const [draft, setDraft] = React.useState("")
  const chips = React.useMemo(
    () =>
      value
        .split(",")
        .map((chip) => chip.trim())
        .filter(Boolean),
    [value],
  )

  const commit = (next: string[]) => {
    onChange(next.join(", "))
  }

  const addChip = () => {
    const cleaned = draft.trim().replace(/,+$/, "")
    if (!cleaned) return
    if (chips.includes(cleaned)) {
      setDraft("")
      return
    }
    commit([...chips, cleaned])
    setDraft("")
  }

  const removeChip = (chip: string) => {
    commit(chips.filter((c) => c !== chip))
  }

  return (
    <div className={styles.tagList}>
      {chips.map((chip) => (
        <span key={chip} className={styles.tagChip}>
          <span>{chip}</span>
          <button
            type="button"
            onClick={() => removeChip(chip)}
            className={styles.tagRemove}
            aria-label={t("editor.ui.removeTagAria", { tag: chip })}
          >
            <X />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault()
            addChip()
          } else if (event.key === "Backspace" && !draft && chips.length > 0) {
            event.preventDefault()
            removeChip(chips[chips.length - 1])
          }
        }}
        onBlur={addChip}
        placeholder={chips.length === 0 ? t("editor.placeholders.tags") : "+"}
        className={styles.tagInput}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main canvas                                                        */
/* ------------------------------------------------------------------ */
type AgentCanvasProps = {
  t: Translation
  draft: TaskAgentDraft
  taskAgentModelSelectValue: string
  selectedTaskAgentModelOption: TaskAgentModelOption | null
  unknownTaskAgentModelLabel: string
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  updateDraft: <K extends keyof TaskAgentDraft>(key: K, value: TaskAgentDraft[K]) => void
  handleTaskAgentModelChange: (value: string) => void
}

export function AgentCanvas({
  t,
  draft,
  taskAgentModelSelectValue,
  selectedTaskAgentModelOption,
  unknownTaskAgentModelLabel,
  isLoadingModels,
  modelGroups,
  updateDraft,
  handleTaskAgentModelChange,
}: AgentCanvasProps) {
  const promptChars = draft.task_prompt.length
  const hasPrompt = promptChars > 0

  const promptTextareaClass = hasPrompt
    ? styles.promptTextarea
    : `${styles.promptTextarea} ${styles.promptTextareaEmpty}`

  const promptCountClass = hasPrompt
    ? styles.promptCount
    : `${styles.promptCount} ${styles.promptCountEmpty}`

  return (
    <div className={styles.root}>
      {/* Description Area */}
      <section className="space-y-4">
        <div className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">
          {t("editor.fields.description")}
        </div>
        <DescriptionStrip
          t={t}
          value={draft.description}
          onChange={(next) => updateDraft("description", next)}
        />
      </section>

      <div className={styles.rule} />

      {/* Meta Configuration */}
      <section className="grid grid-cols-2 gap-16">
        <div className="space-y-8">
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>{t("editor.ui.neuralEngine")}</span>
            <div className={styles.metaEngine}>
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
          </div>

          <div className={styles.metaField}>
            <span className={styles.metaLabel}>{t("editor.ui.statusVisibility")}</span>
            <div className={styles.statusCluster}>
              <TogglePill
                checked={draft.is_enabled}
                onChange={(next) => updateDraft("is_enabled", next)}
                onLabel={t("badges.enabled")}
                offLabel={t("badges.disabled")}
                iconOn={Zap}
                iconOff={Zap}
                tone="ok"
              />
              <TogglePill
                checked={draft.discoverable}
                onChange={(next) => updateDraft("discoverable", next)}
                onLabel={t("badges.discoverable")}
                offLabel={t("badges.hidden")}
                iconOn={Eye}
                iconOff={EyeOff}
                tone="accent"
              />
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>{t("editor.ui.classification")}</span>
            <span className="flex items-center gap-3 text-[11px] font-bold tracking-widest text-[var(--ink)] uppercase">
              <MessageSquare className="size-3.5 opacity-50" />
              {t("badges.chat")}
            </span>
          </div>

          <div className={styles.metaField}>
            <span className={styles.metaLabel}>{t("editor.fields.tags")}</span>
            <TagChips
              t={t}
              value={draft.tags_input}
              onChange={(next) => updateDraft("tags_input", next)}
            />
          </div>
        </div>
      </section>

      <div className={styles.rule} />

      {/* Primary Instruction Set (Prompt) */}
      <section className={styles.prompt}>
        <header className={styles.promptHead}>
          <span className={styles.promptLabel}>
            <span>{t("editor.fields.taskPrompt").toUpperCase()}</span>
            <span className={styles.promptRequired}>*</span>
          </span>
          <span className={promptCountClass}>
            {t("editor.ui.bitUnits", { count: promptChars.toLocaleString() })}
          </span>
        </header>

        <textarea
          id="task-agent-prompt"
          value={draft.task_prompt}
          onChange={(event) => updateDraft("task_prompt", event.target.value)}
          placeholder={t("editor.placeholders.taskPrompt")}
          className={promptTextareaClass}
        />
      </section>
    </div>
  )
}
