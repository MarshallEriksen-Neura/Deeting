"use client"

import { useState, useCallback, useEffect } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { RotateCcw, Loader2, ArrowUpDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/shadcn/alert-dialog"
import { GlassButton } from "@/ui/common/glass-button"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { listMemorySnapshots, rollbackMemory } from "@/lib/api/memory"
import type { MemorySnapshotItem } from "@/types/memory"
import { MemoryDiffView } from "./memory-diff-view"

function normalizeMetadata(value: unknown) {
  if (!value) return null
  if (typeof value === "string") {
    try {
      return normalizeMetadata(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value == null) return "—"
  return JSON.stringify(value)
}

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
  const [snapshots, setSnapshots] = useState<MemorySnapshotItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<MemorySnapshotItem | null>(null)
  const [rollbackConfirm, setRollbackConfirm] = useState<MemorySnapshotItem | null>(null)
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

  useEffect(() => {
    if (!open) {
      setSelectedSnapshot(null)
      setRollbackConfirm(null)
      return
    }

    void loadSnapshots()
    setSelectedSnapshot(null)
  }, [open, loadSnapshots])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const handleRollback = async () => {
    if (!rollbackConfirm || !memoryId) return
    setIsRollingBack(true)
    try {
      await rollbackMemory(memoryId, rollbackConfirm.id)
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

  const renderMetadataChanges = (snapshot: MemorySnapshotItem) => {
    const oldMetadata = normalizeMetadata(snapshot.old_metadata)
    const newMetadata = normalizeMetadata(snapshot.new_metadata)
    const keys = Array.from(
      new Set([...Object.keys(oldMetadata ?? {}), ...Object.keys(newMetadata ?? {})])
    )
    const changedKeys = keys.filter(
      (key) => JSON.stringify(oldMetadata?.[key]) !== JSON.stringify(newMetadata?.[key])
    )

    if (changedKeys.length === 0) {
      return null
    }

    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-300">{t("snapshot.metadataTitle")}</p>
        <div className="space-y-2">
          {changedKeys.map((key) => (
            <div key={key} className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg bg-black/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">{key}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-300 break-words">
                  {formatMetadataValue(oldMetadata?.[key])}
                </p>
              </div>
              <div className="rounded-lg bg-blue-500/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-blue-300">{key}</p>
                <p className="mt-1 text-xs text-gray-700 dark:text-gray-100 break-words">
                  {formatMetadataValue(newMetadata?.[key])}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
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
                      <div
                        role="button"
                        tabIndex={0}
                        className={`w-full text-left rounded-xl p-4 border transition-all ${
                          isSelected
                            ? "border-blue-500/40 bg-blue-500/5"
                            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedSnapshot(isSelected ? null : snap)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedSnapshot(isSelected ? null : snap)
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${colorClass}`}>
                              {t(`snapshot.action.${snap.action}`)}
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
                      </div>

                      {isSelected && (snap.old_content || snap.new_content || snap.old_metadata || snap.new_metadata) && (
                        <div className="ml-4">
                          {(snap.old_content || snap.new_content) && (
                            <MemoryDiffView
                              oldContent={snap.old_content ?? ""}
                              newContent={snap.new_content ?? ""}
                            />
                          )}
                          {renderMetadataChanges(snap)}
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
