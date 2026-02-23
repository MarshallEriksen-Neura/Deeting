"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Eraser, BrainCircuit, Loader2, Plus } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Textarea } from "@/components/ui/textarea"
import { useMemories } from "@/lib/swr"
import { updateMemory, deleteMemory, clearAllMemories } from "@/lib/api/memory"
import type { MemoryItem } from "@/types/memory"
import { MemoryCard } from "./memory-card"

export function MemoryClient() {
  const t = useTranslations("memory")
  const { memories, isLoading, isLoadingMore, isReachedEnd, mutate, loadMore } = useMemories(24)

  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null)
  const [editContent, setEditContent] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  // Handlers with Optimistic Updates
  const handleUpdate = async () => {
    if (!editingItem) return
    setIsUpdating(true)
    
    // Optimistic Update locally
    const previousMemories = memories
    const updatedMemories = memories.map(m => 
      m.id === editingItem.id ? { ...m, content: editContent } : m
    )
    
    try {
      // We don't use full mutate(updatedMemories, false) here because useSWRInfinite is complex
      // Instead we use simple mutate() after success
      await updateMemory(editingItem.id, { content: editContent })
      toast.success(t("success.updated"))
      mutate()
      setEditingItem(null)
    } catch (err) {
      toast.error("Failed to update memory")
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMemory(id)
      toast.success(t("success.deleted"))
      mutate()
    } catch (err) {
      toast.error("Failed to delete memory")
    } finally {
      setDeleteId(null)
    }
  }, [mutate, t])

  const handleClearAll = async () => {
    try {
      await clearAllMemories()
      toast.success(t("success.cleared"))
      mutate()
    } catch (err) {
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
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing {memories.length} memories
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

      {memories.length === 0 ? (
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
      ) : (
        <InfiniteList
          hasMore={!isReachedEnd}
          isLoading={!!isLoadingMore}
          onLoadMore={loadMore}
          useScrollArea={false}
          noMoreDisplay="— 没有更多记忆了 —"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {memories.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                onEdit={(item) => {
                  setEditingItem(item)
                  setEditContent(item.content)
                }}
                onDelete={setDeleteId}
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
    </div>
  )
}
