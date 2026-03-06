"use client"

import { useState, useCallback, useEffect } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Upload, FolderPlus, Search, AlertTriangle, RefreshCw } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { Button } from "@/components/ui/button"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { KnowledgeStatsBar } from "./knowledge-stats-bar"
import { BreadcrumbNav } from "./breadcrumb-nav"
import { KnowledgeTable } from "./knowledge-table"
import { FileActionsMenu } from "./file-actions-menu"
import { FileUploadDialog } from "./file-upload-dialog"
import { FileDetailDrawer } from "./file-detail-drawer"
import { NewFolderDialog } from "./new-folder-dialog"
import { MoveCopyDialog } from "./move-copy-dialog"
import { useKnowledgeTree, useKnowledgeStats, useFileChunks } from "@/lib/swr"
import {
  createFolder,
  updateFolder,
  updateFile,
  deleteFolder,
  deleteFile,
  copyFile,
  retryFile,
  getFileDownloadUrl,
  shareFile,
} from "@/lib/api/knowledge"
import type {
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

export function KnowledgeClient() {
  const t = useTranslations("knowledge")

  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

  // Sort state
  const [sortField, setSortField] = useState<KnowledgeSortField>("createdAt")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Dialog state
  const [uploadOpen, setUploadOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [moveCopyOpen, setMoveCopyOpen] = useState(false)
  const [moveCopyMode, setMoveCopyMode] = useState<"move" | "copy">("move")
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")

  // Detail drawer state
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "file" | "folder"
    name: string
    id: string
  } | null>(null)

  // Active item for move/copy/rename
  const [activeItem, setActiveItem] = useState<{
    type: "file" | "folder"
    id: string
  } | null>(null)

  // Data fetching via SWR
  const {
    files,
    folders,
    breadcrumb: breadcrumbPath,
    isLoading: isTreeLoading,
    mutate: mutateTree,
  } = useKnowledgeTree({
    parentId: currentFolderId,
    q: debouncedSearch || undefined,
    sortField,
    sortDirection,
  })

  const { data: stats, isLoading: isStatsLoading, error: statsError, mutate: mutateStats } = useKnowledgeStats()

  const { chunks: selectedFileChunks, isLoading: isChunksLoading } =
    useFileChunks(selectedFile?.id ?? null, {
      enabled: drawerOpen && selectedFile?.status === "active",
    })

  // Auto-refresh when there are processing files
  const hasProcessingFiles = files.some((f) => f.status === "processing")
  useEffect(() => {
    if (!hasProcessingFiles) return
    const interval = setInterval(() => {
      mutateTree()
      mutateStats()
    }, 5000)
    return () => clearInterval(interval)
  }, [hasProcessingFiles, mutateTree, mutateStats])

  // Refresh all data
  const refreshAll = useCallback(() => {
    mutateTree()
    mutateStats()
  }, [mutateTree, mutateStats])

  // Handlers
  const handleSort = useCallback(
    (field: KnowledgeSortField) => {
      if (field === sortField) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setSortField(field)
        setSortDirection("asc")
      }
    },
    [sortField]
  )

  const handleFolderClick = useCallback((folderId: string) => {
    setCurrentFolderId(folderId)
    setSearchQuery("")
  }, [])

  const handleNavigate = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId)
    setSearchQuery("")
  }, [])

  const handleFileClick = useCallback((file: KnowledgeFile) => {
    setSelectedFile(file)
    setDrawerOpen(true)
  }, [])

  const handleNewFolder = useCallback(
    async (name: string) => {
      try {
        await createFolder({ name, parentId: currentFolderId })
        setNewFolderOpen(false)
        refreshAll()
        toast.success(t("toast.folderCreated"))
      } catch {
        toast.error(t("toast.folderCreateFailed"))
      }
    },
    [currentFolderId, refreshAll, t]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === "file") {
        await deleteFile(deleteTarget.id)
      } else {
        await deleteFolder(deleteTarget.id, true)
      }
      setDeleteTarget(null)
      // Close drawer if the deleted file was selected
      if (
        deleteTarget.type === "file" &&
        selectedFile?.id === deleteTarget.id
      ) {
        setDrawerOpen(false)
        setSelectedFile(null)
      }
      refreshAll()
      toast.success(t("toast.deleted"))
    } catch {
      toast.error(t("toast.deleteFailed"))
    }
  }, [deleteTarget, selectedFile, refreshAll, t])

  const handleRenameConfirm = useCallback(async () => {
    if (!activeItem || !renameValue.trim()) return
    try {
      if (activeItem.type === "file") {
        await updateFile(activeItem.id, { name: renameValue.trim() })
      } else {
        await updateFolder(activeItem.id, { name: renameValue.trim() })
      }
      setRenameDialogOpen(false)
      setActiveItem(null)
      refreshAll()
      toast.success(t("toast.renamed"))
    } catch {
      toast.error(t("toast.renameFailed"))
    }
  }, [activeItem, renameValue, refreshAll, t])

  const handleMoveCopy = useCallback(
    async (targetFolderId: string | null) => {
      if (!activeItem) return
      try {
        if (moveCopyMode === "move") {
          if (activeItem.type === "file") {
            await updateFile(activeItem.id, { folderId: targetFolderId })
          }
          // Folder move is not supported by backend, so we only support file move
        } else {
          if (activeItem.type === "file") {
            await copyFile(activeItem.id, { folderId: targetFolderId })
          }
        }
        setMoveCopyOpen(false)
        setActiveItem(null)
        refreshAll()
        toast.success(
          moveCopyMode === "move" ? t("toast.moved") : t("toast.copied")
        )
      } catch {
        toast.error(t("toast.operationFailed"))
      }
    },
    [activeItem, moveCopyMode, refreshAll, t]
  )

  const handleDownload = useCallback(
    async (file: KnowledgeFile) => {
      try {
        const url = await getFileDownloadUrl(file.id)
        window.open(url, "_blank")
      } catch {
        toast.error(t("toast.downloadFailed"))
      }
    },
    [t]
  )

  const handleShare = useCallback(
    async (file: KnowledgeFile) => {
      try {
        const url = await shareFile(file.id)
        await navigator.clipboard.writeText(url)
        toast.success(t("toast.shareLinkCopied"))
      } catch {
        toast.error(t("toast.shareFailed"))
      }
    },
    [t]
  )

  const handleRetry = useCallback(
    async (fileId: string) => {
      try {
        await retryFile(fileId)
        refreshAll()
        toast.success(t("toast.retryStarted"))
      } catch {
        toast.error(t("toast.retryFailed"))
      }
    },
    [refreshAll, t]
  )

  // Render actions for table rows
  const renderActions = useCallback(
    (item: KnowledgeFile | KnowledgeFolder, type: "file" | "folder") => {
      const isFile = type === "file"
      const file = isFile ? (item as KnowledgeFile) : undefined

      return (
        <FileActionsMenu
          type={type}
          status={file?.status}
          onPreview={
            isFile
              ? () => {
                  setSelectedFile(file!)
                  setDrawerOpen(true)
                }
              : undefined
          }
          onDownload={
            isFile ? () => handleDownload(file!) : undefined
          }
          onRename={() => {
            setActiveItem({ type, id: item.id })
            setRenameValue("name" in item ? item.name : "")
            setRenameDialogOpen(true)
          }}
          onMove={() => {
            setActiveItem({ type, id: item.id })
            setMoveCopyMode("move")
            setMoveCopyOpen(true)
          }}
          onCopy={
            isFile
              ? () => {
                  setActiveItem({ type, id: item.id })
                  setMoveCopyMode("copy")
                  setMoveCopyOpen(true)
                }
              : undefined
          }
          onShare={isFile ? () => handleShare(file!) : undefined}
          onDelete={() => {
            setDeleteTarget({ type, name: item.name, id: item.id })
          }}
          onRetry={
            isFile && file?.status === "failed"
              ? () => handleRetry(file!.id)
              : undefined
          }
        />
      )
    },
    [handleDownload, handleShare, handleRetry]
  )

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex gap-3">
          <GlassButton variant="secondary" size="sm" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus className="h-4 w-4 mr-1" />
            {t("newFolder")}
          </GlassButton>
          <GlassButton size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-1" />
            {t("upload")}
          </GlassButton>
        </div>
      </div>

      {/* Stats Bar */}
      {isStatsLoading && (
        <div className="flex items-center gap-6 rounded-xl border border-gray-200/80 dark:border-white/10 bg-white dark:bg-white/[0.02] p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      )}
      {stats && <KnowledgeStatsBar stats={stats} />}
      {statsError && !stats && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t("error.loadFailed")}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => mutateStats()} className="ml-auto hover:text-red-700 dark:hover:text-red-300">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Breadcrumb */}
      {currentFolderId !== null && (
        <BreadcrumbNav path={breadcrumbPath} onNavigate={handleNavigate} />
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-[var(--muted)]" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("search")}
          className="max-w-xs"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200/80 dark:border-white/10 bg-white dark:bg-white/[0.02] shadow-sm dark:shadow-2xl/10 overflow-hidden">
        <KnowledgeTable
          files={files}
          folders={folders}
          isLoading={isTreeLoading}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onFolderClick={handleFolderClick}
          onFileClick={handleFileClick}
          renderActions={renderActions}
        />
      </div>

      {/* Upload Dialog */}
      <FileUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        currentFolderId={currentFolderId}
        onUploadComplete={refreshAll}
      />

      {/* New Folder Dialog */}
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        onConfirm={handleNewFolder}
      />

      {/* Move/Copy Dialog */}
      <MoveCopyDialog
        open={moveCopyOpen}
        onOpenChange={setMoveCopyOpen}
        mode={moveCopyMode}
        folders={folders}
        currentFolderId={currentFolderId}
        onConfirm={handleMoveCopy}
      />

      {/* File Detail Drawer */}
      <FileDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        file={selectedFile}
        chunks={selectedFileChunks}
        isChunksLoading={isChunksLoading}
        onDownload={() => selectedFile && handleDownload(selectedFile)}
        onShare={() => selectedFile && handleShare(selectedFile)}
        onDelete={() => {
          if (selectedFile) {
            setDeleteTarget({
              type: "file",
              name: selectedFile.name,
              id: selectedFile.id,
            })
          }
        }}
      />

      {/* Rename Dialog */}
      <AlertDialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("renameDialog.title")}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("renameDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRenameConfirm}>
              {t("renameDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "folder"
                ? t("deleteConfirm.folderDescription", { name: deleteTarget?.name ?? "" })
                : t("deleteConfirm.fileDescription", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t("deleteConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
