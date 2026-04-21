"use client"

import * as React from "react"
import { TabsContent } from "@/components/ui/shadcn/tabs"
import { TaskAgentSectionHeader } from "../task-agent-section-header"
import type {
  DraftPayload,
  PreviewDraft,
  TaskAgentDraft,
} from "../task-agent-editor-types"

type Translation = (key: string, values?: Record<string, string | number>) => string

type DebugCardProps = {
  title: string
  rows: Array<{ label: string; value: React.ReactNode }>
}

function DebugCard({ title, rows }: DebugCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 p-4">
      <p className="ws-meta text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">
        {title}
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-start justify-between gap-3">
            <dt className="ws-body text-xs opacity-60">{label}</dt>
            <dd className="ws-control max-w-[60%] text-right text-xs font-bold text-[var(--ink-1)] truncate">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

type ChatDebugTabProps = {
  t: Translation
  draft: TaskAgentDraft
  previewDraft: PreviewDraft
  draftPayload: DraftPayload
}

export function ChatDebugTab({
  t,
  draft,
  previewDraft,
  draftPayload,
}: ChatDebugTabProps) {
  return (
    <TabsContent value="debug" className="space-y-6">
      <TaskAgentSectionHeader title={t("debug.title")} description={t("debug.description")} />

      <div className="grid gap-4 lg:grid-cols-3">
        <DebugCard
          title={t("debug.cards.identity")}
          rows={[
            {
              label: t("editor.fields.model"),
              value: draft.model.trim() || "default",
            },
            {
              label: t("editor.fields.invocationKind"),
              value: t("badges.chat"),
            },
          ]}
        />
        <DebugCard
          title={t("debug.cards.bindings")}
          rows={[
            {
              label: t("editor.fields.boundTools"),
              value: draft.callable_mcp_tool_ids.length,
            },
            {
              label: t("editor.fields.boundSkills"),
              value: draft.guidance_skill_ids.length,
            },
            {
              label: t("editor.fields.boundAsset"),
              value: draft.bound_asset_id || "none",
            },
            {
              label: t("editor.fields.preferredForImageGeneration"),
              value: draft.preferred_for_image_generation
                ? t("editor.values.preferredForImageGenerationOn")
                : t("editor.values.preferredForImageGenerationOff"),
            },
            {
              label: t("editor.fields.discoverable"),
              value: draft.discoverable
                ? t("badges.discoverable")
                : t("badges.hidden"),
            },
          ]}
        />
        <DebugCard
          title={t("debug.cards.preview")}
          rows={[
            {
              label: t("preview.fields.maxRounds"),
              value: previewDraft.max_rounds.trim() || "default",
            },
            {
              label: t("preview.fields.maxTokens"),
              value: previewDraft.max_tokens.trim() || "default",
            },
            {
              label: t("preview.fields.temperature"),
              value: previewDraft.temperature.trim() || "default",
            },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 p-4">
        <p className="ws-meta mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">
          {t("debug.rawProfile")}
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--panel-bg)]/60 p-3 font-mono text-[11px] leading-relaxed text-[var(--ink-2)]">
          {JSON.stringify({ payload: draftPayload }, null, 2)}
        </pre>
      </div>
    </TabsContent>
  )
}
