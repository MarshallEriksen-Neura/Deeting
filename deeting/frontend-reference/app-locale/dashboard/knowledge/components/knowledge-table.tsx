"use client"

import React, { useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  FileImage,
  File,
  Folder,
  ArrowUpDown,
  Inbox,
} from "lucide-react"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/ui/shadcn/table"
import { StatusPill } from "@/ui/common/status-pill"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/ui/shadcn/tooltip"
import { Skeleton } from "@/ui/shadcn/skeleton"
import { cn } from "@/lib/utils"
import type {
  KnowledgeFile,
  KnowledgeFolder,
  FileType,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* -------------------------------------------------------------------------- */
/*  File type icon mapping                                                    */
/* -------------------------------------------------------------------------- */

const FILE_ICON_MAP: Record<FileType, { icon: typeof File; className: string }> = {
  pdf: { icon: FileText, className: "text-red-500" },
  docx: { icon: FileText, className: "text-blue-500" },
  txt: { icon: FileText, className: "text-gray-500" },
  md: { icon: FileCode, className: "text-purple-500" },
  csv: { icon: FileSpreadsheet, className: "text-green-500" },
  xlsx: { icon: FileSpreadsheet, className: "text-emerald-500" },
  html: { icon: FileCode, className: "text-orange-500" },
  json: { icon: FileCode, className: "text-yellow-500" },
  png: { icon: FileImage, className: "text-pink-500" },
  jpg: { icon: FileImage, className: "text-pink-500" },
  jpeg: { icon: FileImage, className: "text-pink-500" },
  webp: { icon: FileImage, className: "text-pink-500" },
}

function getFileIcon(type: FileType) {
  return FILE_ICON_MAP[type] ?? { icon: File, className: "text-muted-foreground" }
}

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface KnowledgeTableProps {
  files: KnowledgeFile[]
  folders: KnowledgeFolder[]
  isLoading?: boolean
  sortField: KnowledgeSortField
  sortDirection: SortDirection
  onSort: (field: KnowledgeSortField) => void
  onFolderClick: (folderId: string) => void
  onFileClick: (file: KnowledgeFile) => void
  renderActions: (item: KnowledgeFile | KnowledgeFolder, type: "file" | "folder") => React.ReactNode
}

/* -------------------------------------------------------------------------- */
/*  Sortable column header                                                    */
/* -------------------------------------------------------------------------- */

interface SortableHeaderProps {
  field: KnowledgeSortField
  label: string
  currentField: KnowledgeSortField
  currentDirection: SortDirection
  onSort: (field: KnowledgeSortField) => void
}

const SortableHeader = React.memo(
  ({ field, label, currentField, currentDirection, onSort }: SortableHeaderProps) => {
    const handleClick = useCallback(() => onSort(field), [onSort, field])

    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        <ArrowUpDown
          className={cn(
            "h-3.5 w-3.5",
            currentField === field
              ? "text-foreground"
              : "text-muted-foreground/50"
          )}
        />
      </button>
    )
  }
)

SortableHeader.displayName = "SortableHeader"

/* -------------------------------------------------------------------------- */
/*  Folder row                                                                */
/* -------------------------------------------------------------------------- */

interface FolderRowProps {
  folder: KnowledgeFolder
  onFolderClick: (folderId: string) => void
  renderActions: (item: KnowledgeFolder, type: "folder") => React.ReactNode
}

const FolderRow = React.memo(({ folder, onFolderClick, renderActions }: FolderRowProps) => {
  const handleClick = useCallback(
    () => onFolderClick(folder.id),
    [onFolderClick, folder.id]
  )

  return (
    <TableRow className="hover:bg-[var(--surface)]/40 transition-colors cursor-pointer">
      <TableCell>
        <Folder className="h-6 w-6 text-amber-500" />
      </TableCell>
      <TableCell>
        <button
          onClick={handleClick}
          className="text-left hover:underline cursor-pointer font-medium"
        >
          {folder.name}/
        </button>
      </TableCell>
      <TableCell>&mdash;</TableCell>
      <TableCell>&mdash;</TableCell>
      <TableCell>&mdash;</TableCell>
      <TableCell>{formatDate(folder.createdAt)}</TableCell>
      <TableCell>{renderActions(folder, "folder")}</TableCell>
    </TableRow>
  )
})

FolderRow.displayName = "FolderRow"

/* -------------------------------------------------------------------------- */
/*  File row                                                                  */
/* -------------------------------------------------------------------------- */

interface FileRowProps {
  file: KnowledgeFile
  onFileClick: (file: KnowledgeFile) => void
  renderActions: (item: KnowledgeFile, type: "file") => React.ReactNode
  t: ReturnType<typeof useTranslations>
}

const FileRow = React.memo(({ file, onFileClick, renderActions, t }: FileRowProps) => {
  const { icon: Icon, className: iconClassName } = getFileIcon(file.type)
  const isProcessing = file.status === "processing"

  const handleClick = useCallback(() => onFileClick(file), [onFileClick, file])

  const statusCell = useMemo(() => {
    switch (file.status) {
      case "active":
        return <StatusPill tone="success" text={t("status.active")} />
      case "processing":
        return <StatusPill tone="warn" isLoading text={t("status.processing")} />
      case "failed":
        return file.errorMessage ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <StatusPill tone="error" text={t("status.failed")} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{file.errorMessage}</TooltipContent>
          </Tooltip>
        ) : (
          <StatusPill tone="error" text={t("status.failed")} />
        )
      default:
        return null
    }
  }, [file.status, file.errorMessage, t])

  const chunksDisplay = useMemo(() => {
    if (file.status === "active") {
      return file.chunks != null ? file.chunks.toLocaleString() : "0"
    }
    if (isProcessing) return "--"
    return "0"
  }, [file.status, file.chunks, isProcessing])

  return (
    <TableRow
      className={cn(
        "hover:bg-[var(--surface)]/40 transition-colors cursor-default",
        isProcessing && "opacity-75"
      )}
    >
      <TableCell>
        <Icon className={cn("h-6 w-6", iconClassName)} />
      </TableCell>
      <TableCell>
        <button
          onClick={handleClick}
          className="text-left hover:underline cursor-pointer"
        >
          {file.name}
        </button>
      </TableCell>
      <TableCell>{statusCell}</TableCell>
      <TableCell>{chunksDisplay}</TableCell>
      <TableCell>{formatBytes(file.size)}</TableCell>
      <TableCell>{formatDate(file.createdAt)}</TableCell>
      <TableCell>{renderActions(file, "file")}</TableCell>
    </TableRow>
  )
})

FileRow.displayName = "FileRow"

/* -------------------------------------------------------------------------- */
/*  Skeleton rows                                                             */
/* -------------------------------------------------------------------------- */

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={`skeleton-${i}`}>
          <TableCell>
            <Skeleton className="h-6 w-6 rounded" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-40" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

const KnowledgeTable = React.memo(
  ({
    files,
    folders,
    isLoading = false,
    sortField,
    sortDirection,
    onSort,
    onFolderClick,
    onFileClick,
    renderActions,
  }: KnowledgeTableProps) => {
    const t = useTranslations("knowledge")

    const isEmpty = !isLoading && files.length === 0 && folders.length === 0

    const sortedItems = useMemo(() => {
      const sortedFolders = [...folders]
      const sortedFiles = [...files]

      const dir = sortDirection === "asc" ? 1 : -1

      if (sortField === "name") {
        sortedFolders.sort((a, b) => dir * a.name.localeCompare(b.name))
        sortedFiles.sort((a, b) => dir * a.name.localeCompare(b.name))
      } else if (sortField === "size") {
        sortedFiles.sort((a, b) => dir * (a.size - b.size))
      } else if (sortField === "chunks") {
        sortedFiles.sort((a, b) => dir * ((a.chunks ?? 0) - (b.chunks ?? 0)))
      } else if (sortField === "createdAt") {
        sortedFolders.sort(
          (a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        )
        sortedFiles.sort(
          (a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        )
      }

      return { folders: sortedFolders, files: sortedFiles }
    }, [files, folders, sortField, sortDirection])

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">{t("table.type")}</TableHead>
            <TableHead>
              <SortableHeader
                field="name"
                label={t("table.name")}
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>{t("table.status")}</TableHead>
            <TableHead>
              <SortableHeader
                field="chunks"
                label={t("table.chunks")}
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>
              <SortableHeader
                field="size"
                label={t("table.size")}
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>
              <SortableHeader
                field="createdAt"
                label={t("table.createdAt")}
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>{t("table.actions")}</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <SkeletonRows />
          ) : isEmpty ? (
            <TableRow>
              <TableCell colSpan={7}>
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Inbox className="h-10 w-10 mb-3" />
                  <p className="text-sm">{t("table.empty")}</p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            <>
              {sortedItems.folders.map((folder) => (
                <FolderRow
                  key={`folder-${folder.id}`}
                  folder={folder}
                  onFolderClick={onFolderClick}
                  renderActions={renderActions}
                />
              ))}
              {sortedItems.files.map((file) => (
                <FileRow
                  key={`file-${file.id}`}
                  file={file}
                  onFileClick={onFileClick}
                  renderActions={renderActions}
                  t={t}
                />
              ))}
            </>
          )}
        </TableBody>
      </Table>
    )
  }
)

KnowledgeTable.displayName = "KnowledgeTable"

export { KnowledgeTable }
