"use client"

import { useState, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Upload,
  X,
  FileText,
  FileSpreadsheet,
  FileCode,
  File,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { GlassButton } from "@/components/ui/glass-button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { uploadFile } from "@/lib/api/knowledge"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const SUPPORTED_TYPES = ["PDF", "TXT", "DOCX", "MD", "CSV", "XLSX", "HTML", "JSON"]

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "pdf":
    case "docx":
    case "txt":
      return FileText
    case "csv":
    case "xlsx":
      return FileSpreadsheet
    case "md":
    case "html":
    case "json":
      return FileCode
    default:
      return File
  }
}

interface FileUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentFolderId: string | null
  onUploadComplete?: () => void
}

export function FileUploadDialog({
  open,
  onOpenChange,
  currentFolderId,
  onUploadComplete,
}: FileUploadDialogProps) {
  const t = useTranslations("knowledge")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadStatus, setUploadStatus] = useState<
    Record<string, "pending" | "uploading" | "success" | "error">
  >({})

  const isUploading = Object.values(uploadStatus).some((s) => s === "uploading")

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    setFiles((prev) => [...prev, ...droppedFiles])
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files)
      setFiles((prev) => [...prev, ...selected])
    }
  }, [])

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name))
    setUploadProgress((prev) => {
      const copy = { ...prev }
      delete copy[name]
      return copy
    })
    setUploadStatus((prev) => {
      const copy = { ...prev }
      delete copy[name]
      return copy
    })
  }, [])

  const handleUpload = useCallback(async () => {
    const statusInit: Record<string, "uploading"> = {}
    const progressInit: Record<string, number> = {}
    files.forEach((f) => {
      statusInit[f.name] = "uploading"
      progressInit[f.name] = 0
    })
    setUploadStatus(statusInit)
    setUploadProgress(progressInit)

    let successCount = 0
    let errorCount = 0

    await Promise.allSettled(
      files.map(async (f) => {
        try {
          const created = await uploadFile(f, currentFolderId, (percent) => {
            setUploadProgress((prev) => ({ ...prev, [f.name]: percent }))
          })
          if (created.status === "failed") {
            setUploadStatus((prev) => ({ ...prev, [f.name]: "error" }))
            errorCount++
            return
          }
          setUploadStatus((prev) => ({ ...prev, [f.name]: "success" }))
          setUploadProgress((prev) => ({ ...prev, [f.name]: 100 }))
          successCount++
        } catch {
          setUploadStatus((prev) => ({ ...prev, [f.name]: "error" }))
          errorCount++
        }
      })
    )

    if (successCount > 0) {
      toast.success(t("toast.uploadSuccess", { count: successCount }))
      onUploadComplete?.()
    }
    if (errorCount > 0) {
      toast.error(t("toast.uploadFailed", { count: errorCount }))
    }

    // Auto-close after a short delay if all succeeded
    if (errorCount === 0) {
      setTimeout(() => {
        setFiles([])
        setUploadProgress({})
        setUploadStatus({})
        onOpenChange(false)
      }, 1000)
    }
  }, [files, currentFolderId, onOpenChange, onUploadComplete, t])

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isUploading) {
        setFiles([])
        setUploadProgress({})
        setUploadStatus({})
      }
      if (!isUploading) {
        onOpenChange(nextOpen)
      }
    },
    [isUploading, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("uploadDialog.title")}</DialogTitle>
          <DialogDescription>{t("uploadDialog.description")}</DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
            isDragging
              ? "border-[var(--primary)] bg-[var(--primary)]/5"
              : "border-[var(--border)] hover:border-[var(--primary)]/50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            accept=".pdf,.txt,.docx,.md,.csv,.xlsx,.html,.json"
          />
          <Upload
            className={cn(
              "h-10 w-10 mx-auto mb-3",
              isDragging ? "text-[var(--primary)]" : "text-[var(--muted)]"
            )}
          />
          <p className="text-sm text-[var(--muted)]">
            {isDragging ? t("uploadDialog.dropHint") : t("uploadDialog.selectFiles")}
          </p>
        </div>

        {/* Supported types */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{t("uploadDialog.supportedTypes")}:</span>
          {SUPPORTED_TYPES.map((type) => (
            <Badge key={type} variant="secondary" className="text-[10px]">
              {type}
            </Badge>
          ))}
          <span className="text-xs text-[var(--muted)] ml-2">
            {t("uploadDialog.maxSize")} 50MB
          </span>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((file) => {
              const Icon = getFileIcon(file.name)
              const status = uploadStatus[file.name]
              const progress = uploadProgress[file.name] ?? 0

              return (
                <div
                  key={file.name}
                  className="flex items-center gap-3 rounded-lg bg-[var(--surface)]/40 px-3 py-2"
                >
                  <Icon className="h-5 w-5 text-[var(--muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{file.name}</p>
                    {status === "uploading" ? (
                      <Progress value={progress} className="h-1 mt-1" />
                    ) : (
                      <p className="text-xs text-[var(--muted)]">{formatBytes(file.size)}</p>
                    )}
                  </div>
                  {status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : status === "error" ? (
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : !status ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(file.name)
                      }}
                      className="text-[var(--muted)] hover:text-[var(--foreground)] shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <GlassButton variant="secondary" onClick={() => handleClose(false)} disabled={isUploading}>
            {t("uploadDialog.cancel")}
          </GlassButton>
          <GlassButton onClick={handleUpload} disabled={files.length === 0 || isUploading} loading={isUploading}>
            {t("uploadDialog.confirm")}
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
