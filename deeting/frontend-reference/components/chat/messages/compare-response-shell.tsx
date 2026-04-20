"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs"
import { AIResponseBubble } from "./ai-response-bubble"
import { CompareModelDialog } from "./compare-model-dialog"
import type { MessageCompareState } from "@/store/chat-store"
import type { ModelInfo } from "@/lib/api/models"
import { useI18n } from "@/hooks/use-i18n"

interface CompareResponseShellProps {
  messageId: string
  compareState: MessageCompareState
  models: ModelInfo[]
  onCompare: (messageId: string, modelValue: string) => void
  onFinalize: (messageId: string, modelKey: string) => void
}

export function CompareResponseShell({
  messageId,
  compareState,
  models,
  onCompare,
  onFinalize,
}: CompareResponseShellProps) {
  const t = useI18n("chat")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const candidates = React.useMemo(() => Object.values(compareState.candidates), [compareState.candidates])
  const sortedCandidates = React.useMemo(
    () => [...candidates].sort((a, b) => Number(Boolean(b.baseline)) - Number(Boolean(a.baseline))),
    [candidates]
  )
  const activeCandidate = compareState.candidates[compareState.activeModelKey] ?? sortedCandidates[0]

  if (!activeCandidate) return null

  return (
    <div className="space-y-3">
      <Tabs
        value={activeCandidate.modelKey}
        onValueChange={(value) => {
          if (compareState.candidates[value]) {
            onCompare(messageId, value)
          }
        }}
        className="gap-3"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          {sortedCandidates.map((candidate) => (
            <TabsTrigger
              key={candidate.modelKey}
              value={candidate.modelKey}
              className="h-9 rounded-full border bg-muted/60 px-3 text-xs"
            >
              <span className="max-w-[9rem] truncate">{candidate.modelId}</span>
              {candidate.baseline ? <span className="text-[10px] text-muted-foreground">· {t("compare.current")}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {sortedCandidates.map((candidate) => (
          <TabsContent key={candidate.modelKey} value={candidate.modelKey} className="mt-0">
            <AIResponseBubble
              parts={candidate.blocks}
              isActive={candidate.loading}
              streamEnabled={candidate.loading}
              typingEnabled={false}
              statusStage={candidate.statusStage ?? null}
              statusCode={candidate.statusCode ?? null}
              statusMeta={candidate.statusMeta ?? null}
            />
            {candidate.errorMessage ? (
              <p className="mt-2 text-xs text-destructive">{candidate.errorMessage}</p>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("compare.actions.addModel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={activeCandidate.loading || compareState.isFinalizing}
          onClick={() => onFinalize(messageId, activeCandidate.modelKey)}
        >
          {compareState.isFinalizing
            ? t("compare.actions.finalizing")
            : activeCandidate.baseline
              ? t("compare.actions.keepCurrent")
              : t("compare.actions.useAsFinal")}
        </Button>
      </div>

      <CompareModelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        models={models}
        excludedModelKeys={sortedCandidates.map((candidate) => candidate.modelKey)}
        onSelect={(modelValue) => onCompare(messageId, modelValue)}
      />
    </div>
  )
}