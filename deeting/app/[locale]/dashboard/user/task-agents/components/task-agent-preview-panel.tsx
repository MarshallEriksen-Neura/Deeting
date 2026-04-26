"use client"

import * as React from "react"
import {
  ImageIcon,
  Play,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { CustomTaskAgentPreviewResponse } from "@/lib/api/custom-task-agents"
import AudioResultPanel from "@/components/audio/audio-result-panel"
import type { PreviewDraft, TaskAgentDraft } from "./task-agent-editor-types"
import { buildTaskAgentCapabilityHealth } from "./task-agents-helpers"

type Translation = (key: string, values?: Record<string, string | number>) => string

type TaskAgentPreviewPanelProps = {
  t: Translation
  selectedAgent: { id: string } | null
  draft: TaskAgentDraft
  previewDraft: PreviewDraft
  previewResult: CustomTaskAgentPreviewResponse | null
  previewError: string | null
  isPreviewing: boolean
  setPreviewDraft: React.Dispatch<React.SetStateAction<PreviewDraft>>
  handleRunPreview: () => Promise<void>
}

export function TaskAgentPreviewPanel({
  t,
  selectedAgent,
  draft,
  previewDraft,
  previewResult,
  previewError,
  isPreviewing,
  setPreviewDraft,
  handleRunPreview,
}: TaskAgentPreviewPanelProps) {
  const capabilityHealth = buildTaskAgentCapabilityHealth(draft)

  return (
    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid gap-16 xl:grid-cols-[300px_1fr]">
        {/* Input Parameters */}
        <aside className="space-y-12">
          <div className="space-y-8">
            <div className="space-y-4">
              <label className="font-mono text-[9px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">
                {t("preview.fields.message")}
              </label>
              <textarea
                value={previewDraft.message}
                onChange={(event) =>
                  setPreviewDraft((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
                rows={6}
                placeholder={t("preview.placeholders.message")}
                disabled={!selectedAgent}
                className="w-full bg-transparent border-b border-[var(--hairline-strong)] py-2 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-4)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors resize-none"
              />
            </div>

            <div className="space-y-6">
              {[
                { id: "temperature", label: t("preview.fields.temperature"), value: previewDraft.temperature, placeholder: "0.2" },
                { id: "max_tokens", label: t("preview.fields.maxTokens"), value: previewDraft.max_tokens, placeholder: "512" },
                { id: "max_rounds", label: t("preview.fields.maxRounds"), value: previewDraft.max_rounds, placeholder: "4" },
              ].map(field => (
                <div key={field.id} className="space-y-2">
                  <label className="font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">
                    {field.label}
                  </label>
                  <input
                    value={field.value}
                    onChange={(event) =>
                      setPreviewDraft((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    disabled={!selectedAgent}
                    className="w-full bg-transparent border-b border-[var(--hairline-subtle)] py-1 text-[11px] font-mono text-[var(--ink-2)] focus:outline-none focus:border-[var(--accent-strong)] transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleRunPreview}
            disabled={isPreviewing || !selectedAgent || !previewDraft.message.trim()}
            className="w-full h-12 border border-[var(--ink)] text-[var(--ink)] font-bold text-[10px] tracking-[0.3em] uppercase hover:bg-[var(--ink)] hover:text-[var(--window-bg)] disabled:opacity-20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
          >
            <Play className={cn("size-3", isPreviewing && "animate-pulse")} />
            {isPreviewing ? t("actions.runningPreview") : t("actions.runPreview")}
          </button>
        </aside>

        {/* Execution Output */}
        <main className="min-h-[500px] space-y-12">
          {capabilityHealth.isGuidanceOnly ? (
            <div className="border-l-2 border-[var(--warning)] pl-6 py-2 space-y-2">
              <span className="font-mono text-[10px] font-bold text-[var(--warning)] tracking-widest uppercase">{t("bindings.guidanceOnlyWarningTitle")}</span>
              <p className="text-sm text-[var(--ink-2)] leading-relaxed">{t("bindings.guidanceOnlyWarningDescription")}</p>
            </div>
          ) : null}
          {previewError && (
            <div className="border-l-2 border-[var(--danger)] pl-6 py-2 space-y-2">
              <span className="font-mono text-[10px] font-bold text-[var(--danger)] tracking-widest uppercase">{t("preview.errorTitle")}</span>
              <p className="text-sm text-[var(--ink-2)] leading-relaxed">{previewError}</p>
            </div>
          )}

          {!previewResult && !previewError ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-20">
              <Sparkles className="size-8" />
              <p className="font-mono text-[10px] tracking-[0.4em] uppercase">{t("preview.emptyDescription")}</p>
            </div>
          ) : previewResult ? (
            <div className="space-y-16">
               {/* Core Content */}
               <section className="space-y-6">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[10px] font-bold tracking-[0.3em] text-[var(--accent-strong)] uppercase">{t("preview.response")}</span>
                    <div className="h-px flex-1 bg-[var(--hairline-strong)] opacity-20" />
                  </div>
                  
                  {previewResult.invocation_kind === "image_generation" ? (
                    <div className="grid gap-8 md:grid-cols-2">
                      {previewResult.images.map((image, index) => (
                        <div key={index} className="group relative aspect-square bg-[var(--panel-bg-inset)] border border-[var(--hairline)]">
                           <img src={image} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                        </div>
                      ))}
                    </div>
                  ) : previewResult.invocation_kind === "text_to_speech" ? (
                    <div className="py-4 border-y border-[var(--hairline-subtle)]">
                      <AudioResultPanel
                        payload={
                          (previewResult.raw as Record<string, unknown> | null | undefined) ?? {
                            source_url: previewResult.audios[0] ?? null,
                            prompt_text: previewDraft.message,
                          }
                        }
                      />
                    </div>
                  ) : (
                    <div className="text-lg leading-relaxed text-[var(--ink-2)] max-w-2xl whitespace-pre-wrap">
                      {previewResult.content}
                    </div>
                  )}
               </section>

               {/* Reasoning Trace */}
               {previewResult.reasoning_content && (
                  <section className="space-y-6">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-[10px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">{t("preview.reasoning")}</span>
                      <div className="h-px flex-1 bg-[var(--hairline-strong)] opacity-10" />
                    </div>
                    <div className="text-[13px] leading-relaxed text-[var(--ink-3)] font-serif italic opacity-80 max-w-2xl whitespace-pre-wrap">
                      {previewResult.reasoning_content}
                    </div>
                  </section>
               )}

               {/* Technical Logs */}
               <section className="space-y-10 pt-10">
                  {(
                    [
                      { title: t("preview.toolCalls"), data: previewResult.tool_calls, icon: Wrench },
                      { title: t("preview.toolTrace"), data: previewResult.tool_trace, icon: Zap },
                      { title: t("preview.raw"), data: previewResult.raw, icon: ImageIcon }
                    ] as { title: string; data: unknown; icon: React.ElementType }[]
                  ).map(log => {
                    const hasData = log.data && (Array.isArray(log.data) ? (log.data as unknown[]).length > 0 : Object.keys(log.data as object).length > 0)
                    if (!hasData) return null
                    return (
                      <div key={log.title} className="space-y-4">
                        <header className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <log.icon className="size-3 text-[var(--ink-4)]" />
                            <span className="font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--ink-4)] uppercase">{log.title}</span>
                          </div>
                        </header>
                        <div className="bg-[var(--panel-bg-inset)]/40 p-6 border border-[var(--hairline-subtle)] overflow-hidden">
                           <pre className="text-[10px] font-mono text-[var(--ink-3)] leading-relaxed overflow-x-auto custom-scrollbar">
                              {JSON.stringify(log.data, null, 2)}
                           </pre>
                        </div>
                      </div>
                    )
                  })}
               </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
