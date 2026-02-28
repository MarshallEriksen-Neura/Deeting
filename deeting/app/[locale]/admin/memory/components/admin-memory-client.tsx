"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Loader2, Plus, Brain } from "lucide-react"
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
import { useAdminSystemMemories } from "@/lib/swr/use-admin-memory"
import { addAdminSystemMemory, updateAdminSystemMemory, deleteAdminSystemMemory } from "@/lib/api/admin-memory"
import type { MemoryItem } from "@/types/memory"
import { MemoryCard } from "../../../dashboard/memory/components/memory-card"

export function AdminMemoryClient() {
  const t = useTranslations("memory")
  const systemMemoryT = useTranslations("admin.systemMemory.page")
  const { memories, isLoading, isLoadingMore, isReachedEnd, mutate, loadMore } = useAdminSystemMemories(24)

  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null)
  const [editContent, setEditContent] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)
  
  const [isAdding, setIsAdding] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addContent, setAddContent] = useState("")

  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!addContent.trim()) return
    setIsAdding(true)
    try {
      await addAdminSystemMemory({ content: addContent })
      toast.success(systemMemoryT("toast.addSuccess"))
      mutate()
      setAddDialogOpen(false)
      setAddContent("")
    } catch {
      toast.error(systemMemoryT("toast.addError"))
    } finally {
      setIsAdding(false)
    }
  }

  const handleUpdate = async () => {
    if (!editingItem) return
    setIsUpdating(true)
    try {
      await updateAdminSystemMemory(editingItem.id, { content: editContent })
      toast.success(t("success.updated"))
      mutate()
      setEditingItem(null)
    } catch {
      toast.error(systemMemoryT("toast.updateError"))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteAdminSystemMemory(id)
      toast.success(t("success.deleted"))
      mutate()
    } catch {
      toast.error(systemMemoryT("toast.deleteError"))
    } finally {
      setDeleteId(null)
    }
  }, [mutate, systemMemoryT, t])

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
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {systemMemoryT("stats.entryCount", { count: memories.length })}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <GlassButton
            onClick={() => setAddDialogOpen(true)}
            className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            {systemMemoryT("actions.addKnowledge")}
          </GlassButton>
        </div>
      </div>

      {memories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-400/20 blur-3xl rounded-full" />
            <div className="relative w-24 h-24 bg-white/50 dark:bg-white/5 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-3xl flex items-center justify-center shadow-2xl">
              <Brain className="w-12 h-12 text-purple-500/80" />
            </div>
          </div>
          <div className="max-w-xs space-y-2">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {systemMemoryT("empty.title")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {systemMemoryT("empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <InfiniteList
          hasMore={!isReachedEnd}
          isLoading={!!isLoadingMore}
          onLoadMore={loadMore}
          useScrollArea={false}
          noMoreDisplay={systemMemoryT("list.noMore")}
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

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>{systemMemoryT("dialogs.add.title")}</DialogTitle>
            <DialogDescription>
              {systemMemoryT("dialogs.add.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <Textarea
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              className="min-h-[180px] text-base"
              placeholder={systemMemoryT("dialogs.add.placeholder")}
            />
          </div>
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setAddDialogOpen(false)}>
              {t("actions.cancel")}
            </GlassButton>
            <GlassButton className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleAdd} disabled={isAdding}>
              {isAdding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("actions.save")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>{t("actions.edit")}</DialogTitle>
            <DialogDescription>{t("fields.content")}</DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[180px] text-base"
            />
          </div>
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setEditingItem(null)}>
              {t("actions.cancel")}
            </GlassButton>
            <GlassButton className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleUpdate} disabled={isUpdating}>
              {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("actions.save")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirm.delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
