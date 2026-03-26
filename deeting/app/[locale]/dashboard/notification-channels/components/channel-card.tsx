"use client"

import { useCallback, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Switch } from "@/components/ui/switch"
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
import { cn } from "@/lib/utils"
import type { NotificationChannel } from "@/lib/api/notification-channels"
import {
  deleteNotificationChannel,
  updateNotificationChannel,
} from "@/lib/api/notification-channels"
import { ChannelConfigForm } from "./channel-config-form"
import { CHANNEL_COLORS, CHANNEL_ICONS } from "./channel-shared"

export function ChannelCard({
  channel,
  onRefresh,
}: {
  channel: NotificationChannel
  onRefresh: () => void | Promise<unknown>
}) {
  const t = useTranslations("dashboard.notificationChannelsPage")
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const Icon = CHANNEL_ICONS[channel.channel]
  const channelLabel = t(`channelTypes.${channel.channel}.label`)
  const channelDescription = t(`channelTypes.${channel.channel}.description`)

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      await updateNotificationChannel(channel.id, {
        is_active: !channel.is_active,
      })
      await onRefresh()
    } finally {
      setToggling(false)
    }
  }, [channel.id, channel.is_active, onRefresh])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await deleteNotificationChannel(channel.id)
      await onRefresh()
      setDeleteDialogOpen(false)
    } finally {
      setDeleting(false)
    }
  }, [channel.id, onRefresh])

  return (
    <GlassCard padding="default" hover="none">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            CHANNEL_COLORS[channel.channel]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {channel.display_name || channelLabel}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                channel.is_active
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-zinc-500/10 text-zinc-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  channel.is_active ? "bg-emerald-400" : "bg-zinc-400"
                )}
              />
              {channel.is_active ? t("status.enabled") : t("status.disabled")}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            {channelDescription}
            {channel.last_used_at ? (
              <span className="ml-2 opacity-60">
                ·{" "}
                {t("status.lastUsedDate", {
                  date: new Date(channel.last_used_at).toLocaleDateString(),
                })}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Switch
            checked={channel.is_active}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />

          <GlassButton
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? t("actions.collapse") : t("actions.expand")}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </GlassButton>

          <GlassButton
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={deleting}
            aria-label={t("actions.delete")}
            className="text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </GlassButton>
        </div>
      </div>

      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-white/5 pt-4">
              <ChannelConfigForm
                channelType={channel.channel}
                channelId={channel.id}
                initialConfig={channel.config}
                initialDisplayName={channel.display_name ?? ""}
                onSave={async (config, displayName) => {
                  await updateNotificationChannel(channel.id, {
                    config,
                    display_name: displayName || undefined,
                  })
                  await onRefresh()
                  setExpanded(false)
                }}
                onCancel={() => setExpanded(false)}
                showTest
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteDialog.title", { channel: channel.display_name || channelLabel })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t("actions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  )
}

