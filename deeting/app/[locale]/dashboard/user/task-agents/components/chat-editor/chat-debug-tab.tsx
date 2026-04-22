"use client"

import * as React from "react"
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
    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <section className="space-y-6">
        <div className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--ink)] uppercase">
          {t("debug.stateDump")}
        </div>
        
        <div className="grid gap-12 lg:grid-cols-3">
          <DebugCard
            title={t("debug.cards.identity")}
            rows={[
              {
                label: t("editor.fields.model"),
                value: draft.model.trim() || t("debug.values.default"),
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
                value: draft.bound_asset_id || t("debug.values.none"),
              },
              {
                label: t("editor.fields.preferredForImageGeneration"),
                value: draft.preferred_for_image_generation
                  ? t("debug.values.yes")
                  : t("debug.values.no"),
              },
              {
                label: t("editor.fields.discoverable"),
                value: draft.discoverable
                  ? t("debug.values.surfaced")
                  : t("debug.values.redacted"),
              },
            ]}
          />
          <DebugCard
            title={t("debug.cards.preview")}
            rows={[
              {
                label: t("preview.fields.maxRounds"),
                value: previewDraft.max_rounds.trim() || t("debug.values.default"),
              },
              {
                label: t("preview.fields.maxTokens"),
                value: previewDraft.max_tokens.trim() || t("debug.values.default"),
              },
              {
                label: t("preview.fields.temperature"),
                value: previewDraft.temperature.trim() || t("debug.values.default"),
              },
            ]}
          />
        </div>
      </section>

      <section className="space-y-4">
        <header className="flex items-center justify-between">
           <div className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">
             {t("debug.rawProfileProtocol")}
           </div>
        </header>
        <div className="bg-[var(--panel-bg-inset)]/40 p-8 border border-[var(--hairline-strong)]">
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--ink-3)]">
            {JSON.stringify({ payload: draftPayload }, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  )
}
