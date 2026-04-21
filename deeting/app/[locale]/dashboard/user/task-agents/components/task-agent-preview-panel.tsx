"use client"

import * as React from "react"
import {
  Bot,
  BrainCircuit,
  ImageIcon,
  Play,
  Sparkles,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"
import { Label } from "@/components/ui/shadcn/label"
import { TabsContent } from "@/components/ui/shadcn/tabs"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { cn } from "@/lib/utils"
import type { CustomTaskAgentPreviewResponse } from "@/lib/api/custom-task-agents"
import AudioResultPanel from "@/components/audio/audio-result-panel"
import type { PreviewDraft } from "./task-agent-editor-types"
import { TaskAgentSectionHeader } from "./task-agent-section-header"

type Translation = (key: string, values?: Record<string, string | number>) => string

function PreviewDisclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-sm font-medium text-[var(--foreground)]">{title}</span>
        <span className="text-[var(--muted)]">{open ? "-" : "+"}</span>
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  )
}

type TaskAgentPreviewPanelProps = {
  t: Translation
  selectedAgent: { id: string } | null
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
  previewDraft,
  previewResult,
  previewError,
  isPreviewing,
  setPreviewDraft,
  handleRunPreview,
}: TaskAgentPreviewPanelProps) {
  return (
    <TabsContent value="preview" className="space-y-6">
      <TaskAgentSectionHeader
        title={t("preview.title")}
        description={t("preview.description")}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="space-y-2">
            <Label htmlFor="preview-message">{t("preview.fields.message")}</Label>
            <Textarea
              id="preview-message"
              value={previewDraft.message}
              onChange={(event) =>
                setPreviewDraft((current) => ({
                  ...current,
                  message: event.target.value,
                }))
              }
              rows={8}
              placeholder={t("preview.placeholders.message")}
              disabled={!selectedAgent}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="preview-temperature">
                {t("preview.fields.temperature")}
              </Label>
              <Input
                id="preview-temperature"
                value={previewDraft.temperature}
                onChange={(event) =>
                  setPreviewDraft((current) => ({
                    ...current,
                    temperature: event.target.value,
                  }))
                }
                placeholder="0.2"
                disabled={!selectedAgent}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preview-max-tokens">{t("preview.fields.maxTokens")}</Label>
              <Input
                id="preview-max-tokens"
                value={previewDraft.max_tokens}
                onChange={(event) =>
                  setPreviewDraft((current) => ({
                    ...current,
                    max_tokens: event.target.value,
                  }))
                }
                placeholder="512"
                disabled={!selectedAgent}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preview-max-rounds">{t("preview.fields.maxRounds")}</Label>
              <Input
                id="preview-max-rounds"
                value={previewDraft.max_rounds}
                onChange={(event) =>
                  setPreviewDraft((current) => ({
                    ...current,
                    max_rounds: event.target.value,
                  }))
                }
                placeholder="4"
                disabled={!selectedAgent}
              />
            </div>
          </div>

          <Button
            onClick={handleRunPreview}
            disabled={isPreviewing || !selectedAgent || !previewDraft.message.trim()}
            className="w-full"
          >
            <Play className={cn("mr-2 size-4", isPreviewing && "animate-pulse")} />
            {isPreviewing ? t("actions.runningPreview") : t("actions.runPreview")}
          </Button>

          {!selectedAgent ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-[var(--muted)]">
              {t("preview.unsavedDescription")}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          {previewError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-center gap-2 text-red-200">
                <XCircle className="size-4" />
                <span className="font-medium">{t("preview.errorTitle")}</span>
              </div>
              <p className="mt-2 text-sm text-red-100/90">{previewError}</p>
            </div>
          ) : null}

          {!previewResult ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-8 text-center">
              <Sparkles className="size-10 text-[var(--muted)]" />
              <p className="mt-4 font-medium text-[var(--foreground)]">
                {t("preview.emptyTitle")}
              </p>
              <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
                {t("preview.emptyDescription")}
              </p>
            </div>
          ) : previewResult.invocation_kind === "image_generation" ? (
            <div className="space-y-4">
              <TaskAgentSectionHeader title={t("preview.images")} />
              <div className="grid gap-4 md:grid-cols-2">
                {previewResult.images.map((image, index) => (
                  <div
                    key={`${image}-${index}`}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt={t("preview.imageAlt", { index: index + 1 })}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : previewResult.invocation_kind === "text_to_speech" ? (
            <div className="space-y-4">
              <TaskAgentSectionHeader title={t("preview.audio")} />
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
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <Bot className="size-4" />
                  {t("preview.response")}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">
                  {previewResult.content || "-"}
                </p>
              </div>

              {previewResult.reasoning_content ? (
                <PreviewDisclosure title={t("preview.reasoning")} defaultOpen={true}>
                  <div className="flex items-center gap-2 pb-3 text-sm font-medium text-[var(--foreground)]">
                    <BrainCircuit className="size-4" />
                    {t("preview.reasoning")}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                    {previewResult.reasoning_content}
                  </p>
                </PreviewDisclosure>
              ) : null}
            </div>
          )}

          {previewResult ? (
            <div className="space-y-4">
              <PreviewDisclosure
                title={t("preview.toolCalls")}
                defaultOpen={previewResult.tool_calls.length > 0}
              >
                <div className="flex items-center gap-2 pb-3 text-sm font-medium text-[var(--foreground)]">
                  <Wrench className="size-4" />
                  {t("preview.toolCalls")}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
                  {JSON.stringify(previewResult.tool_calls, null, 2)}
                </pre>
              </PreviewDisclosure>

              <PreviewDisclosure
                title={t("preview.toolTrace")}
                defaultOpen={previewResult.tool_trace.length > 0}
              >
                <div className="flex items-center gap-2 pb-3 text-sm font-medium text-[var(--foreground)]">
                  <Zap className="size-4" />
                  {t("preview.toolTrace")}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
                  {JSON.stringify(previewResult.tool_trace, null, 2)}
                </pre>
              </PreviewDisclosure>

              <PreviewDisclosure title={t("preview.raw")}>
                <div className="flex items-center gap-2 pb-3 text-sm font-medium text-[var(--foreground)]">
                  <ImageIcon className="size-4" />
                  {t("preview.raw")}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
                  {JSON.stringify(previewResult.raw ?? {}, null, 2)}
                </pre>
              </PreviewDisclosure>
            </div>
          ) : null}
        </div>
      </div>
    </TabsContent>
  )
}
