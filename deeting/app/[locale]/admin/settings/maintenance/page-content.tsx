"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"

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
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { isTauriRuntime } from "@/lib/api/desktop-config"
import { repairLocalSystemAssetIndexFromCloud } from "@/lib/api/desktop-system-assets"
import { syncLocalSkillInstallsFromCloud } from "@/lib/api/plugin-market"

export function PageContent() {
  const t = useTranslations("admin.maintenanceSettingsPage")
  const supported = isTauriRuntime()
  const [mode, setMode] = useState<"sync" | "reinstall" | "repair" | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false)

  const handleSystemSync = async (reinstallMissing: boolean) => {
    setFeedback(null)
    setMode(reinstallMissing ? "reinstall" : "sync")
    try {
      const syncResult = await syncLocalSkillInstallsFromCloud({ reinstallMissing, force: true })
      setFeedback(syncResult
        ? t(reinstallMissing ? "feedback.syncReinstallApplied" : "feedback.syncApplied", {
            fetched: syncResult.fetched_count,
            upserted: syncResult.upserted_count,
            reinstalled: syncResult.reinstalled_count,
            failed: syncResult.failed_count,
          })
        : t("feedback.syncAppliedNoop"))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("feedback.maintenanceFailed"))
    } finally {
      setMode(null)
    }
  }

  const handleRepair = async () => {
    setRepairConfirmOpen(false)
    setFeedback(null)
    setMode("repair")
    try {
      const repairResult = await repairLocalSystemAssetIndexFromCloud()
      setFeedback(repairResult
        ? t("feedback.repairApplied", {
            fetched: repairResult.sync.fetched_count,
            upserted: repairResult.sync.upserted_count,
            skills: repairResult.skill_reindexed_count,
            assistants: repairResult.assistant_reindexed_count,
          })
        : t("feedback.repairAppliedNoop"))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("feedback.maintenanceFailed"))
    } finally {
      setMode(null)
    }
  }

  return (
    <GlassCard padding="default" hover="none" className="max-w-3xl">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("section.title")}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("section.description")}</p>
        </div>

        {!supported ? (
          <p className="text-xs text-[var(--muted)]">{t("empty.desktopOnly")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void handleSystemSync(false)} disabled={mode !== null}>
                {mode === "sync" ? t("actions.syncing") : t("actions.syncAction")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleSystemSync(true)} disabled={mode !== null}>
                {mode === "reinstall" ? t("actions.syncing") : t("actions.syncReinstallAction")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRepairConfirmOpen(true)} disabled={mode !== null}>
                {mode === "repair" ? t("actions.repairingAction") : t("actions.repairIndexAction")}
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)]">{t("section.note")}</p>
          </>
        )}

        {feedback ? <p className="text-xs text-[var(--muted)]" role="status">{feedback}</p> : null}
      </div>

      <AlertDialog open={repairConfirmOpen} onOpenChange={setRepairConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repairConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("repairConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-amber-600 dark:text-amber-400">{t("repairConfirm.warning")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("repairConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => void handleRepair()} disabled={mode === "repair"}>
              {mode === "repair" ? t("actions.repairingAction") : t("repairConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  )
}