"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { useI18n } from "@/hooks/use-i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { Button } from "@/ui/shadcn/button"
import type { WorkflowArtifactContent } from "@/lib/workflow/types"

interface PhaseResultViewerProps {
  open: boolean
  onClose: () => void
  phaseId: string
  phaseTitle: string
  artifact: WorkflowArtifactContent | null
  loading?: boolean
}

export function PhaseResultViewer({
  open,
  onClose,
  phaseId,
  phaseTitle,
  artifact,
  loading = false,
}: PhaseResultViewerProps) {
  const t = useI18n("workflow")
  const [copied, setCopied] = useState(false)
  const copyText = getCopyText(artifact)

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API may not be available
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[min(82vh,860px)] w-[calc(100vw-32px)] max-w-[920px] flex-col gap-0 overflow-hidden rounded-[20px] p-0">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4 pr-24">
          <DialogTitle className="text-base">{t("result.viewerTitle")}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {phaseId}: {phaseTitle}
            {artifact?.file_name ? ` · ${artifact.file_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-14 top-3 h-8 w-8 z-10"
            disabled={!copyText || loading}
            onClick={() => copyText && handleCopy(copyText)}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <ScrollArea className="h-full">
            <div className="px-7 py-6">
              {loading ? (
                <p className="text-sm text-muted-foreground">{t("result.loadingArtifacts")}</p>
              ) : artifact ? (
                <ArtifactBody artifact={artifact} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("result.noResults")}</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ArtifactBody({ artifact }: { artifact: WorkflowArtifactContent }) {
  const t = useI18n("workflow")

  if (artifact.kind === "markdown") {
    return (
      <MarkdownViewer
        content={artifact.content ?? ""}
        className="chat-markdown chat-markdown-assistant text-sm leading-relaxed"
      />
    )
  }

  if (artifact.content?.trim()) {
    return (
      <pre className="whitespace-pre-wrap text-xs text-foreground font-mono leading-relaxed">
        {artifact.content}
      </pre>
    )
  }

  if (artifact.json !== null) {
    return (
      <pre className="whitespace-pre-wrap text-xs text-foreground font-mono leading-relaxed">
        {JSON.stringify(artifact.json, null, 2)}
      </pre>
    )
  }

  return <p className="text-sm text-muted-foreground">{t("result.noResults")}</p>
}

function getCopyText(artifact: WorkflowArtifactContent | null): string | null {
  if (!artifact) return null
  if (artifact.content?.trim()) return artifact.content
  if (artifact.json !== null) return JSON.stringify(artifact.json, null, 2)
  return null
}
