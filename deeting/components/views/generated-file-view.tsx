"use client"

import { memo } from "react"
import { Download } from "lucide-react"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import { formatFileSize } from "@/lib/utils/file"
import type { NativeViewProps } from "./registry"

type PreviewKind = "text" | "markdown" | "html" | "none"

interface GeneratedFilePayload {
  name?: string
  path?: string
  size?: number
  content_type?: string
  mime_type?: string
  download_url?: string
  preview_kind?: string
  preview_text?: string
  truncated?: boolean
}

function toPayload(data: unknown): GeneratedFilePayload | null {
  if (!data || typeof data !== "object") return null
  return data as GeneratedFilePayload
}

function normalizePreviewKind(value: string | undefined): PreviewKind {
  if (value === "text" || value === "markdown" || value === "html") {
    return value
  }
  return "none"
}

const GeneratedFileView = memo<NativeViewProps>(function GeneratedFileView({ data }) {
  const t = useI18n("chat")
  const payload = toPayload(data)

  if (!payload) {
    return <div className="text-xs text-muted-foreground py-2">{t("views.invalidPayload")}</div>
  }

  const name = payload.name?.trim() || payload.path?.trim() || t("views.generatedFile.untitled")
  const downloadUrl = payload.download_url?.trim() || ""
  const contentType = payload.content_type?.trim() || payload.mime_type?.trim() || t("views.generatedFile.unknown")
  const sizeLabel =
    Number.isFinite(payload.size) && Number(payload.size) >= 0
      ? formatFileSize(Number(payload.size))
      : t("views.generatedFile.unknown")
  const previewKind = normalizePreviewKind(payload.preview_kind)
  const previewText = typeof payload.preview_text === "string" ? payload.preview_text : ""

  const renderPreview = () => {
    if (!previewText) {
      return <div className="text-xs text-muted-foreground">{t("views.generatedFile.noPreview")}</div>
    }
    if (previewKind === "markdown") {
      return (
        <div className="max-h-72 overflow-auto rounded-md border border-border p-2">
          <MarkdownViewer content={previewText} className="chat-markdown chat-markdown-assistant text-xs" />
        </div>
      )
    }
    if (previewKind === "html") {
      return (
        <iframe
          title={name}
          srcDoc={previewText}
          sandbox=""
          className="h-72 w-full rounded-md border border-border bg-background"
          loading="lazy"
        />
      )
    }
    if (previewKind === "text") {
      return (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/20 p-2 text-xs whitespace-pre-wrap break-words">
          {previewText}
        </pre>
      )
    }
    return <div className="text-xs text-muted-foreground">{t("views.generatedFile.noPreview")}</div>
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
        <div className="truncate text-xs font-medium">{name}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t("views.generatedFile.mimeType")}: {contentType}</span>
          <span>{t("views.generatedFile.fileSize")}: {sizeLabel}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{t("views.generatedFile.preview")}</span>
        {downloadUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
              <Download size={14} />
              {t("views.generatedFile.download")}
            </a>
          </Button>
        ) : null}
      </div>

      {renderPreview()}

      {payload.truncated ? (
        <div className="text-[11px] text-muted-foreground">{t("views.generatedFile.truncated")}</div>
      ) : null}
    </div>
  )
})

export default GeneratedFileView
