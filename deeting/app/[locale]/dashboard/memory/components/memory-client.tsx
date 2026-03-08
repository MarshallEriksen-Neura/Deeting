"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Eraser, BrainCircuit, Loader2, Search, X } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { InfiniteList } from "@/components/ui/infinite-list"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useMemories, useMemorySearch } from "@/lib/swr"
import { updateMemory, deleteMemory, clearAllMemories } from "@/lib/api/memory"
import type { MemoryItem } from "@/types/memory"
import { MemoryCard } from "./memory-card"
import { MemorySnapshotsDialog } from "./memory-snapshots-dialog"

const CATEGORIES = ["all", "fact", "preference", "event", "relation"] as const

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function MemoryClient() {
  const t = useTranslations("memory")
  const { memories, isLoading, isLoadingMore, isReachedEnd, mutate, loadMore } = useMemories(24)

  // Search state
  const [searchInput, setSearchInput] = useState("")
  const debouncedQuery = useDebounce(searchInput, 300)
  const isSearchMode = debouncedQuery.length > 0

  // Category filter
  const [category, setCategory] = useState<string>("all")
  const searchCategory = category === "all" ? null : category
  const {
    results: searchResults,
    isSearching,
    mutate: mutateSearch,
  } = useMemorySearch(debouncedQuery, 20, { category: searchCategory })

  // Edit state
  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null)
  const [editContent, setEditContent] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  // Snapshot state
  const [snapshotMemoryId, setSnapshotMemoryId] = useState<string | null>(null)

  const refreshAll = useCallback(async () => {
    await Promise.all([mutate(), mutateSearch()])
  }, [mutate, mutateSearch])

  // Filter memories by category
  const filteredMemories = useMemo(() => {
    const source = isSearchMode ? searchResults : memories

    if (category === "all") return source
    return source.filter((m) => (m.category ?? m.payload?.category) === category)
  }, [isSearchMode, searchResults, memories, category])

  // Handlers
  const handleUpdate = async () => {
    if (!editingItem) return
    setIsUpdating(true)
    try {
      await updateMemory(editingItem.id, { content: editContent })
      toast.success(t("success.updated"))
      await refreshAll()
      setEditingItem(null)
    } catch {
      toast.error("Failed to update memory")
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMemory(id)
      toast.success(t("success.deleted"))
      await refreshAll()
    } catch {
      toast.error("Failed to delete memory")
    } finally {
      setDeleteId(null)
    }
  }, [refreshAll, t])

  const handleClearAll = async () => {
    try {
      await clearAllMemories()
      toast.success(t("success.cleared"))
      await refreshAll()
    } catch {
      toast.error("Failed to clear memories")
    } finally {
      setClearAllConfirm(false)
    }
  }

  if (isLoading && memories.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {[...Array(12)].map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl bg-white/40 dark:bg-white/5" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("search.placeholder")}
            className="pl-9 pr-9 h-10 bg-white/50 dark:bg-white/5 border-white/20 dark:border-white/10 rounded-xl"
          />
          {searchInput && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setSearchInput("")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-[160px] h-10 bg-white/50 dark:bg-white/5 border-white/20 dark:border-white/10 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {t(`filter.${cat}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {isSearchMode
            ? t("search.showing", { count: filteredMemories.length })
            : `Showing ${filteredMemories.length} memories`}
          {isSearching && (
            <Loader2 className="inline-block w-3 h-3 ml-2 animate-spin" />
          )}
        </p>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {memories.length > 0 && (
            <GlassButton
              variant="ghost"
              className="flex-1 sm:flex-none text-red-500 hover:text-red-600 hover:bg-red-50/10"
              onClick={() => setClearAllConfirm(true)}
            >
              <Eraser className="w-4 h-4 mr-2" />
              {t("actions.clearAll")}
            </GlassButton>
          )}
        </div>
      </div>

      {filteredMemories.length === 0 && !isSearchMode ? (
        <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-400/20 blur-3xl rounded-full" />
            <div className="relative w-24 h-24 bg-white/50 dark:bg-white/5 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-3xl flex items-center justify-center shadow-2xl">
              <BrainCircuit className="w-12 h-12 text-blue-500/80" />
            </div>
          </div>
          <div className="max-w-xs space-y-2">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t("empty.title")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("empty.description")}
            </p>
          </div>
        </div>
      ) : filteredMemories.length === 0 && isSearchMode ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <Search className="w-10 h-10 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("search.noResults")}
          </p>
        </div>
      ) : isSearchMode ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredMemories.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              onEdit={(item) => {
                setEditingItem(item)
                setEditContent(item.content)
              }}
              onDelete={setDeleteId}
              onHistory={setSnapshotMemoryId}
            />
          ))}
        </div>
      ) : (
        <InfiniteList
          hasMore={!isReachedEnd}
          isLoading={!!isLoadingMore}
          onLoadMore={loadMore}
          useScrollArea={false}
          noMoreDisplay="— 没有更多记忆了 —"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredMemories.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                onEdit={(item) => {
                  setEditingItem(item)
                  setEditContent(item.content)
                }}
                onDelete={setDeleteId}
                onHistory={setSnapshotMemoryId}
              />
            ))}
          </div>
        </InfiniteList>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-[550px] bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl">{t("actions.edit")}</DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400">
              {t("fields.content")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[180px] bg-white/50 dark:bg-black/20 border-white/20 dark:border-white/10 text-base resize-none focus:ring-blue-500/50"
              placeholder="Enter memory content..."
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <GlassButton variant="ghost" className="h-11" onClick={() => setEditingItem(null)}>
              {t("actions.cancel")}
            </GlassButton>
            <GlassButton className="h-11 px-8 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleUpdate} disabled={isUpdating}>
              {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("actions.save")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{t("confirm.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500 dark:text-gray-400 text-base">
              {t("confirm.delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="h-11 border-white/20 dark:border-white/10">{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-8 bg-red-500 hover:bg-red-600 text-white border-none"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear All Confirm */}
      <AlertDialog open={clearAllConfirm} onOpenChange={setClearAllConfirm}>
        <AlertDialogContent className="bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{t("confirm.clearAll.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500 dark:text-gray-400 text-base">
              {t("confirm.clearAll.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="h-11 border-white/20 dark:border-white/10">{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-8 bg-red-500 hover:bg-red-600 text-white border-none"
              onClick={handleClearAll}
            >
              {t("actions.clearAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Snapshot History Dialog */}
      <MemorySnapshotsDialog
        memoryId={snapshotMemoryId}
        open={!!snapshotMemoryId}
        onOpenChange={(open) => !open && setSnapshotMemoryId(null)}
        onRollbackSuccess={() => {
          void refreshAll()
        }}
      />
    </div>
  )
}
