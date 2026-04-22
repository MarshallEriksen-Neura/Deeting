"use client"

import { useEffect, useMemo, useState } from "react"

import { Container } from "@/components/ui/common/container"
import { Button } from "@/components/ui/shadcn/button"
import {
  CHANNEL_META,
  createNotificationChannel,
  type ChannelType,
} from "@/lib/api/notification-channels"
import {
  getDesktopImSettings,
  type DesktopImSettingsSnapshot,
} from "@/lib/api/desktop-im"
import { useNotificationChannels } from "@/lib/swr/use-notification-channels"

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
    enabledChannelTypes.includes(channel.channel),
  )
  const selectableTypes = useMemo(
    () =>
      (Object.keys(CHANNEL_META) as ChannelType[]).filter(
        (type) => enabledChannelTypes.includes(type) && (isDesktopRuntime() || type !== "wechat"),
      ),
    [],
  )
  const availableTypes = selectableTypes.filter(
    (type) => !channels.some((channel) => channel.channel === type),
  )

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setDesktopImSnapshot(null)
      return
    }

    let active = true
    void getDesktopImSettings()
      .then((snapshot) => {
        if (active) {
          setDesktopImSnapshot(snapshot)
        }
      })
      .catch(() => {
        if (active) {
          setDesktopImSnapshot(null)
        }
      })

    return () => {
      active = false
    }
  }, [channels.length])

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <NotificationChannelsHeader />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void mutate()}>
              刷新
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-56 animate-pulse rounded-2xl border bg-card" />
            ))}
          </div>
        ) : channels.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                desktopImSnapshot={desktopImSnapshot}
                onRefresh={mutate}
              />
            ))}
          </div>
        ) : !showAdd ? (
          <ChannelsEmptyState onAdd={() => setShowAdd(true)} />
        ) : null}

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
      </div>
    </Container>
  )
}
