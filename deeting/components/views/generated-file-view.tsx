"use client"

import { memo, useMemo, useCallback } from "react"
import { Download, FileText, Presentation, Table, File, Eye } from "lucide-react"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import { formatFileSize } from "@/lib/utils/file"
import { cn } from "@/lib/utils"
import { useArtifactStore } from "@/store/artifact-store"
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

const GeneratedFileView = memo<NativeViewProps>(function GeneratedFileView({ data, viewType: rawViewType }) {
  const t = useI18n("chat")
  const payload = toPayload(data)
  const setActiveArtifact = useArtifactStore(state => state.setActiveArtifact)

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

  const fileType = useMemo(() => {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const mime = contentType.toLowerCase()
    
    if (ext === 'docx' || ext === 'doc' || mime.includes('word') || mime.includes('officedocument.wordprocessingml')) {
      return { label: 'Word', color: 'text-blue-600 dark:text-blue-400', icon: FileText, bg: 'bg-blue-50 dark:bg-blue-900/20' }
    }
    if (ext === 'pptx' || ext === 'ppt' || mime.includes('presentation') || mime.includes('officedocument.presentationml')) {
      return { label: 'PPT', color: 'text-orange-600 dark:text-orange-400', icon: Presentation, bg: 'bg-orange-50 dark:bg-orange-900/20' }
    }
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || mime.includes('sheet') || mime.includes('csv') || mime.includes('officedocument.spreadsheetml')) {
      return { label: 'Table', color: 'text-emerald-600 dark:text-emerald-400', icon: Table, bg: 'bg-emerald-50 dark:bg-emerald-900/20' }
    }
    if (ext === 'pdf' || mime.includes('pdf')) {
      return { label: 'PDF', color: 'text-red-600 dark:text-red-400', icon: FileText, bg: 'bg-red-50 dark:bg-red-900/20' }
    }
    return { label: 'File', color: 'text-zinc-600 dark:text-zinc-400', icon: File, bg: 'bg-zinc-50 dark:bg-zinc-900/20' }
  }, [name, contentType])

  const handlePreview = useCallback(() => {
    setActiveArtifact({
      id: name,
      name,
      type: fileType.label.toLowerCase(),
      payload: payload,
    })
  }, [name, fileType.label, payload, setActiveArtifact])

  const renderPreview = () => {
    if (!previewText) return null
    
    return (
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{t("views.generatedFile.preview")}</span>
          {payload.truncated && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">{t("views.generatedFile.truncated")}</span>
          )}
        </div>
        
        {previewKind === "markdown" && (
          <div className="max-h-60 overflow-auto rounded-lg border border-border/50 bg-background/50 p-2.5 shadow-sm transition-all hover:border-border">
            <MarkdownViewer content={previewText} className="chat-markdown chat-markdown-assistant text-xs leading-relaxed" />
          </div>
        )}
        
        {previewKind === "html" && (
          <div className="overflow-hidden rounded-lg border border-border/50 shadow-sm">
            <iframe
              title={name}
              srcDoc={previewText}
              sandbox=""
              className="h-64 w-full bg-white"
              loading="lazy"
            />
          </div>
        )}
        
        {previewKind === "text" && (
          <pre className="max-h-60 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs font-mono leading-relaxed text-zinc-700 dark:text-zinc-300">
            {previewText}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="group/file flex flex-col gap-1">
      {/* Coze Style Main Card */}
      <div className="relative flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-all hover:shadow-md hover:border-border/80 dark:bg-zinc-900/40">
        {/* Icon Area */}
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg", fileType.bg)}>
          <fileType.icon className={cn("h-6 w-6", fileType.color)} />
        </div>

        {/* Info Area */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="truncate text-sm font-semibold tracking-tight text-foreground">{name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{fileType.label}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span>{sizeLabel}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex shrink-0 items-center gap-1.5 ml-2">
          <Button 
            onClick={handlePreview}
            size="icon" 
            variant="ghost" 
            className="h-8 w-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800" 
            title={t("views.generatedFile.preview")}
          >
            <Eye size={16} className="text-zinc-500" />
          </Button>
          {downloadUrl && (
            <Button asChild size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800" title={t("views.generatedFile.download")}>
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                <Download size={16} className="text-zinc-500" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Inline Preview */}
      {renderPreview()}
    </div>
  )
})

export default GeneratedFileView
