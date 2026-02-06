"use client"

import { useState, useCallback, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Upload, FolderPlus, Search } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
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
import { KnowledgeStatsBar } from "./components/knowledge-stats-bar"
import { BreadcrumbNav } from "./components/breadcrumb-nav"
import { KnowledgeTable } from "./components/knowledge-table"
import { FileActionsMenu } from "./components/file-actions-menu"
import { FileUploadDialog } from "./components/file-upload-dialog"
import { FileDetailDrawer } from "./components/file-detail-drawer"
import { NewFolderDialog } from "./components/new-folder-dialog"
import { MoveCopyDialog } from "./components/move-copy-dialog"
import {
  mockStats,
  mockFolders,
  getFilesInFolder,
  getFoldersInFolder,
  getFolderBreadcrumb,
  getChunksForFile,
} from "./mock-data"
import type {
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

export default function KnowledgeBasePage() {
  const t = useTranslations("knowledge")

  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

  // Sort state
  const [sortField, setSortField] = useState<KnowledgeSortField>("createdAt")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  // Search state
  const [searchQuery, setSearchQuery] = useState("")

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

  // Derived data
  const breadcrumbPath = useMemo(
    () => getFolderBreadcrumb(currentFolderId),
    [currentFolderId]
  )

  const files = useMemo(() => {
    const allFiles = getFilesInFolder(currentFolderId)
    if (!searchQuery.trim()) return allFiles
    const q = searchQuery.toLowerCase()
    return allFiles.filter((f) => f.name.toLowerCase().includes(q))
  }, [currentFolderId, searchQuery])

  const folders = useMemo(() => {
    const allFolders = getFoldersInFolder(currentFolderId)
    if (!searchQuery.trim()) return allFolders
    const q = searchQuery.toLowerCase()
    return allFolders.filter((f) => f.name.toLowerCase().includes(q))
  }, [currentFolderId, searchQuery])

  const selectedFileChunks = useMemo(
    () => (selectedFile ? getChunksForFile(selectedFile.id) : []),
    [selectedFile]
  )

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

  const handleNewFolder = useCallback((_name: string) => {
    // Mock: in real app, call API and refresh
    setNewFolderOpen(false)
  }, [])

  const handleDelete = useCallback(() => {
    // Mock: in real app, call API to delete file + Qdrant vectors
    setDeleteTarget(null)
  }, [])

  const handleMoveCopy = useCallback((_targetFolderId: string | null) => {
    // Mock: in real app, call API
    setMoveCopyOpen(false)
    setActiveItem(null)
  }, [])

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
          onDownload={isFile ? () => {} : undefined}
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
          onShare={isFile ? () => {} : undefined}
          onDelete={() => {
            setDeleteTarget({ type, name: item.name, id: item.id })
          }}
          onRetry={isFile && file?.status === "failed" ? () => {} : undefined}
        />
      )
    },
    []
  )

  return (
    <div className="h-full flex flex-col transition-colors duration-300 bg-gray-50 dark:bg-[#05050A]">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-blue-400 dark:to-purple-400">
              {t("title")}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t("subtitle")}</p>
          </div>
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
        <KnowledgeStatsBar stats={mockStats} />

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
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onFolderClick={handleFolderClick}
            onFileClick={handleFileClick}
            renderActions={renderActions}
          />
        </div>
      </div>

      {/* Upload Dialog */}
      <FileUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        currentFolderId={currentFolderId}
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
        folders={mockFolders}
        currentFolderId={currentFolderId}
        onConfirm={handleMoveCopy}
      />

      {/* File Detail Drawer */}
      <FileDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        file={selectedFile}
        chunks={selectedFileChunks}
        onDownload={() => {}}
        onShare={() => {}}
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

      {/* Rename Dialog (using AlertDialog for simplicity) */}
      <AlertDialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("renameDialog.title")}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("renameDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRenameDialogOpen(false)
                setActiveItem(null)
              }}
            >
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
    </div>
  )
}
