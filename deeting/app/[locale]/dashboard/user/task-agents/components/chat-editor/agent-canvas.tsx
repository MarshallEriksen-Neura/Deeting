"use client"

import * as React from "react"
import { Bot, Plus, X, MessageSquare, Sparkles, Eye, EyeOff, Zap } from "lucide-react"
import type { ModelGroup } from "@/lib/api/models"
import { TaskAgentModelPickerField } from "../task-agent-model-picker-field"
import type {
  TaskAgentDraft,
  TaskAgentModelOption,
} from "../task-agent-editor-types"
import styles from "./agent-canvas.module.css"

type Translation = (key: string, values?: Record<string, string | number>) => string

/* ------------------------------------------------------------------ */
/*  Inline name input — editorial display face                         */
/* ------------------------------------------------------------------ */
function InlineNameInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className={styles.nameWrap}>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={styles.nameInput}
      />
      {!value ? <span className={styles.requiredHint}>required</span> : null}
    </div>
  )
}

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
        <span>{t("editor.placeholders.description") || "Add description"}</span>
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
            aria-label={`Remove ${chip}`}
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
      {/* Hero — avatar, name, status cluster, description */}
      <section className={styles.hero}>
        <div className={styles.avatar}>
          <Bot />
        </div>

        <div className={styles.heroBody}>
          <div className={styles.heroHead}>
            <InlineNameInput
              value={draft.name}
              onChange={(next) => updateDraft("name", next)}
              placeholder={t("editor.placeholders.name")}
            />
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

          <DescriptionStrip
            t={t}
            value={draft.description}
            onChange={(next) => updateDraft("description", next)}
          />
        </div>
      </section>

      <div className={styles.rule} />

      {/* Meta — engine owns its own row, type + tags share the next */}
      <section className={styles.meta}>
        <div className={styles.metaField}>
          <span className={styles.metaLabel}>Engine</span>
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

        <div className={styles.metaSplit}>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Type</span>
            <span className={styles.typePill}>
              <MessageSquare />
              {t("badges.chat")}
            </span>
          </div>

          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Tags</span>
            <TagChips
              t={t}
              value={draft.tags_input}
              onChange={(next) => updateDraft("tags_input", next)}
            />
          </div>
        </div>
      </section>

      <div className={styles.rule} />

      {/* Prompt */}
      <section className={styles.prompt}>
        <header className={styles.promptHead}>
          <span className={styles.promptLabel}>
            <Sparkles className={styles.promptLabelIcon} />
            <span>{t("editor.fields.taskPrompt")}</span>
            <span className={styles.promptRequired}>*</span>
          </span>
          <span className={promptCountClass}>
            {promptChars.toLocaleString()} chars
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
