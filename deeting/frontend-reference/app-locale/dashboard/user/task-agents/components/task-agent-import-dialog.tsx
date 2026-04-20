"use client"

import * as React from "react"
import { Download, Loader2 } from "lucide-react"

import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import type { ClaudeAgentImportPreviewResponse } from "@/lib/api/custom-task-agents"

type Translation = (key: string, values?: Record<string, string | number>) => string

interface TaskAgentImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: Translation
  isPreviewing: boolean
  isImporting: boolean
  preview: ClaudeAgentImportPreviewResponse | null
  error: string | null
  onPreview: (payload?: { files?: File[] }) => Promise<unknown>
  onImport: (payload?: { files?: File[] }) => Promise<unknown>
}

export function TaskAgentImportDialog({
  open,
  onOpenChange,
  t,
  isPreviewing,
  isImporting,
  preview,
  error,
  onPreview,
  onImport,
}: TaskAgentImportDialogProps) {
  const [files, setFiles] = React.useState<File[]>([])

  React.useEffect(() => {
    if (!open) {
      setFiles([])
    }
  }, [open])

  const handlePreview = React.useCallback(async () => {
    await onPreview({ files })
  }, [files, onPreview])

  const handleImport = React.useCallback(async () => {
    await onImport({ files })
    onOpenChange(false)
  }, [files, onImport, onOpenChange])

  const selectedFileNames = React.useMemo(
    () => files.map((file) => file.name).join(", "),
    [files],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("importDialog.title")}</DialogTitle>
          <DialogDescription>{t("importDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="claude-agent-upload-files">{t("importDialog.fileLabel")}</Label>
            <Input
              id="claude-agent-upload-files"
              type="file"
              accept=".md,.mdx,text/markdown,text/plain"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <p className="text-xs text-muted-foreground">
              {files.length
                ? t("importDialog.filesSelected", { count: files.length })
                : t("importDialog.fileHint")}
            </p>
            {selectedFileNames ? (
              <p className="text-xs text-muted-foreground">{selectedFileNames}</p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t("importDialog.previewTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {preview?.root_path
                    ? t("importDialog.previewRoot", { value: preview.root_path })
                    : t("importDialog.previewEmpty")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || files.length === 0}
              >
                {isPreviewing && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isPreviewing ? t("importDialog.previewing") : t("importDialog.previewAction")}
              </Button>
            </div>

            {error ? (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            ) : null}

            {preview?.items?.length ? (
              <div className="mt-4 space-y-3">
                {preview.items.map((item) => (
                  <div
                    key={item.source_path}
                    className="rounded-xl border border-border/60 bg-muted/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{item.name}</p>
                          <Badge variant={item.exists ? "secondary" : "outline"}>
                            {item.exists ? t("importDialog.badges.update") : t("importDialog.badges.new")}
                          </Badge>
                        </div>
                        {item.description ? (
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground">{item.relative_path}</p>
                        {(item.inferred_mcp_tool_ids.length || item.inferred_guidance_skill_ids.length) ? (
                          <div className="pt-1 text-[11px] text-muted-foreground">
                            {item.inferred_mcp_tool_ids.length ? (
                              <p>
                                {t("importDialog.toolSummary", {
                                  value: item.inferred_mcp_tool_ids.join(", "),
                                })}
                              </p>
                            ) : null}
                            {item.inferred_guidance_skill_ids.length ? (
                              <p>
                                {t("importDialog.skillSummary", {
                                  value: item.inferred_guidance_skill_ids.join(", "),
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="pt-1 text-[11px] text-muted-foreground">
                            {t("importDialog.noBindings")}
                          </p>
                        )}
                      </div>
                      {item.tags.length ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          {item.tags.slice(0, 4).map((tag) => (
                            <Badge key={`${item.source_path}:${tag}`} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("deleteDialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={isImporting || !preview?.items?.length}
          >
            {isImporting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            {isImporting ? t("importDialog.importing") : t("importDialog.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
