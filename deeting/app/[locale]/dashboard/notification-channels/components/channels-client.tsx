"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useNotificationChannels } from "@/lib/swr/use-notification-channels"
import { createNotificationChannel } from "@/lib/api/notification-channels"
import { CHANNEL_META } from "@/lib/api/notification-channels"
import type { ChannelType } from "@/lib/api/notification-channels"
import { getDesktopImSettings, type DesktopImSettingsSnapshot } from "@/lib/api/desktop-im"
import { GlassCard } from "@/components/ui/glass-card"
import { AddChannelCard } from "./add-channel-card"
import { ChannelCard } from "./channel-card"
import { ChannelsEmptyState } from "./channels-empty-state"
import { NotificationChannelsHeader } from "./notification-channels-header"
import { isDesktopRuntime } from "./channel-shared"

export function NotificationChannelsClient() {
  const { data, isLoading, mutate } = useNotificationChannels()
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<ChannelType | null>(null)
  const [desktopImSnapshot, setDesktopImSnapshot] = useState<DesktopImSettingsSnapshot | null>(null)

  const enabledChannelTypes: ChannelType[] = ["feishu", "wechat", "telegram"]
  const channels = (data?.items ?? []).filter((channel) =>
    enabledChannelTypes.includes(channel.channel)
  )
  const desktopImChannelKey = useMemo(
    () => channels.map((channel) => `${channel.id}:${channel.updated_at}:${channel.is_active}`).join("|"),
    [channels]
  )
  const selectableTypes = (Object.keys(CHANNEL_META) as ChannelType[]).filter(
    (type) => enabledChannelTypes.includes(type) && (isDesktopRuntime() || type !== "wechat")
  )
  const availableTypes = selectableTypes.filter(
    (type) => !channels.some((channel) => channel.channel === type)
  )

  useEffect(() => {
    let active = true
    const shouldLoadDesktopIm = isDesktopRuntime() && channels.length > 0
    if (!shouldLoadDesktopIm) {
      setDesktopImSnapshot(null)
      return () => {
        active = false
      }
    }

    const loadDesktopIm = async () => {
      try {
        const snapshot = await getDesktopImSettings()
        if (active) {
          setDesktopImSnapshot(snapshot)
        }
      } catch {
        if (active) {
          setDesktopImSnapshot(null)
        }
      }
    }

    void loadDesktopIm()
    return () => {
      active = false
    }
  }, [desktopImChannelKey, channels.length])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <NotificationChannelsHeader />

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {isLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <motion.div
                  key={`skel-${index}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <GlassCard padding="default">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--foreground)]/10" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 animate-pulse rounded bg-[var(--foreground)]/10" />
                        <div className="h-3 w-48 animate-pulse rounded bg-[var(--foreground)]/5" />
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))
            : channels.map((channel) => (
                <motion.div
                  key={channel.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChannelCard
                    channel={channel}
                    desktopImSnapshot={desktopImSnapshot}
                    onRefresh={mutate}
                  />
                </motion.div>
              ))}
        </AnimatePresence>
      </div>

      <AddChannelCard
        showAdd={showAdd}
        addType={addType}
        availableTypes={availableTypes}
        onShowAdd={() => setShowAdd(true)}
        onCancelAdd={() => {
          setShowAdd(false)
          setAddType(null)
        }}
        onSelectType={setAddType}
        onResetType={() => setAddType(null)}
        onCreate={async (channelType, config, displayName) => {
          await createNotificationChannel({
            channel: channelType,
            config,
            display_name: displayName || undefined,
          })
          await mutate()
          setShowAdd(false)
          setAddType(null)
        }}
      />

      {!isLoading && channels.length === 0 && !showAdd ? (
        <ChannelsEmptyState onAdd={() => setShowAdd(true)} />
      ) : null}
    </div>
  )
}
