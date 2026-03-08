"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { RotateCcw, Loader2, ArrowUpDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { GlassButton } from "@/components/ui/glass-button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  listMemorySnapshots,
  rollbackMemory,
  type LocalMemorySnapshot,
} from "@/lib/api/local-memory"
import { MemoryDiffView } from "./memory-diff-view"

interface MemorySnapshotsDialogProps {
  memoryId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRollbackSuccess?: () => void
}

const ACTION_COLORS: Record<string, string> = {
  update: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  delete: "bg-red-500/20 text-red-400 border-red-500/30",
  rollback: "bg-amber-500/20 text-amber-400 border-amber-500/30",
}

export function MemorySnapshotsDialog({
  memoryId,
  open,
  onOpenChange,
  onRollbackSuccess,
}: MemorySnapshotsDialogProps) {
  const t = useTranslations("memory")
  const [snapshots, setSnapshots] = useState<LocalMemorySnapshot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<LocalMemorySnapshot | null>(null)
  const [rollbackConfirm, setRollbackConfirm] = useState<LocalMemorySnapshot | null>(null)
  const [isRollingBack, setIsRollingBack] = useState(false)

  const loadSnapshots = useCallback(async () => {
    if (!memoryId) return
    setIsLoading(true)
    try {
      const data = await listMemorySnapshots(memoryId)
      setSnapshots(data)
    } catch {
      // silently fail
    } finally {
      setIsLoading(false)
    }
  }, [memoryId])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        loadSnapshots()
        setSelectedSnapshot(null)
      }
      onOpenChange(nextOpen)
    },
    [loadSnapshots, onOpenChange]
  )

  const handleRollback = async () => {
    if (!rollbackConfirm) return
    setIsRollingBack(true)
    try {
      await rollbackMemory(rollbackConfirm.id)
      toast.success(t("snapshot.rollbackSuccess"))
      onRollbackSuccess?.()
      onOpenChange(false)
    } catch {
      toast.error(t("snapshot.rollbackFailed"))
    } finally {
      setIsRollingBack(false)
      setRollbackConfirm(null)
    }
  }

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ts
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[640px] max-h-[80vh] bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <ArrowUpDown className="w-5 h-5" />
              {t("snapshot.title")}
            </DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400">
              {memoryId?.slice(0, 8)}...
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[55vh] pr-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                {t("snapshot.empty")}
              </div>
            ) : (
              <div className="space-y-3">
                {snapshots.map((snap) => {
                  const isSelected = selectedSnapshot?.id === snap.id
                  const colorClass = ACTION_COLORS[snap.action] ?? ACTION_COLORS.update

                  return (
                    <div key={snap.id} className="space-y-2">
                      <button
                        className={`w-full text-left rounded-xl p-4 border transition-all ${
                          isSelected
                            ? "border-blue-500/40 bg-blue-500/5"
                            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedSnapshot(isSelected ? null : snap)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${colorClass}`}>
                              {t(`snapshot.action.${snap.action}` as any)}
                            </span>
                            <span className="text-xs text-gray-400">
                              {formatTime(snap.created_at)}
                            </span>
                          </div>
                          {snap.old_content && (
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRollbackConfirm(snap)
                              }}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              {t("actions.rollback")}
                            </GlassButton>
                          )}
                        </div>
                        {snap.new_content && (
                          <p className="mt-2 text-xs text-gray-400 line-clamp-2">
                            {snap.new_content}
                          </p>
                        )}
                      </button>

                      {isSelected && (snap.old_content || snap.new_content) && (
                        <div className="ml-4">
                          <MemoryDiffView
                            oldContent={snap.old_content ?? ""}
                            newContent={snap.new_content ?? ""}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rollbackConfirm} onOpenChange={(open) => !open && setRollbackConfirm(null)}>
        <AlertDialogContent className="bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{t("confirm.rollback.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500 dark:text-gray-400 text-base">
              {t("confirm.rollback.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="h-11 border-white/20 dark:border-white/10">
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-8 bg-amber-500 hover:bg-amber-600 text-white border-none"
              onClick={handleRollback}
              disabled={isRollingBack}
            >
              {isRollingBack && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("actions.confirmRollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
