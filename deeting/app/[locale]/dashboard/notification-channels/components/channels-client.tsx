"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Container } from "@/components/ui/common/container"
import {
  CHANNEL_META,
  createNotificationChannel,
  type ChannelType,
} from "@/lib/api/notification-channels"
import {
  getDesktopImSettings,
  type DesktopImRuntimeProfile,
  type DesktopImSettingsSnapshot,
} from "@/lib/api/desktop-im"
import { useNotificationChannels } from "@/lib/swr/use-notification-channels"

import { AddChannelCard } from "./add-channel-card"
import { ChannelCard } from "./channel-card"
import { ChannelsEmptyState } from "./channels-empty-state"
import { NotificationChannelsHeader } from "./notification-channels-header"
import { isDesktopRuntime } from "./channel-shared"

const ENABLED_CHANNEL_TYPES: ChannelType[] = ["feishu", "wechat", "telegram"]

export function NotificationChannelsClient() {
  const { data, isLoading, mutate } = useNotificationChannels()
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<ChannelType | null>(null)
  const [desktopImSnapshot, setDesktopImSnapshot] =
    useState<DesktopImSettingsSnapshot | null>(null)
  const isDesktop = isDesktopRuntime()

  const channels = (data?.items ?? []).filter((channel) =>
    ENABLED_CHANNEL_TYPES.includes(channel.channel),
  )
  const selectableTypes = useMemo(
    () =>
      (Object.keys(CHANNEL_META) as ChannelType[]).filter(
        (type) =>
          ENABLED_CHANNEL_TYPES.includes(type) && (isDesktop || type !== "wechat"),
      ),
    [isDesktop],
  )
  const availableTypes = selectableTypes.filter(
    (type) => !channels.some((channel) => channel.channel === type),
  )

  const refreshDesktopSnapshot = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setDesktopImSnapshot(null)
      return
    }
    try {
      const snapshot = await getDesktopImSettings()
      setDesktopImSnapshot(snapshot)
    } catch {
      setDesktopImSnapshot(null)
    }
  }, [])

  const refreshEverything = useCallback(async () => {
    await Promise.all([mutate(), refreshDesktopSnapshot()])
  }, [mutate, refreshDesktopSnapshot])

  useEffect(() => {
    let active = true

    if (!isDesktop) {
      return () => {
        active = false
      }
    }

    const loadDesktopSnapshot = async () => {
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

    void loadDesktopSnapshot()

    return () => {
      active = false
    }
  }, [channels.length, isDesktop])

  const runtimeProfiles = (isDesktop ? desktopImSnapshot : null)?.runtime_profiles ?? []
  const runtimeReadyCount = runtimeProfiles.filter(isRuntimeReady).length
  const activeChannelCount = channels.filter((channel) => channel.is_active).length

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="space-y-6">
        <NotificationChannelsHeader
          stats={{
            total: channels.length,
            active: activeChannelCount,
            runtimeReady: runtimeReadyCount,
            available: availableTypes.length,
          }}
          onRefresh={() => void refreshEverything()}
          onCreate={() => {
            setShowAdd(true)
            if (!addType && availableTypes[0]) {
              setAddType(availableTypes[0])
            }
          }}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1.08fr)_352px]">
          <section className="space-y-4">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-72 animate-pulse rounded-[28px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]"
                  />
                ))}
              </div>
            ) : channels.length ? (
              <div className="grid gap-5 md:grid-cols-2">
                {channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    desktopImSnapshot={desktopImSnapshot}
                    onRefresh={refreshEverything}
                  />
                ))}
              </div>
            ) : (
              <ChannelsEmptyState
                onAdd={() => {
                  setShowAdd(true)
                  if (!addType && availableTypes[0]) {
                    setAddType(availableTypes[0])
                  }
                }}
              />
            )}
          </section>

          <aside className="self-start xl:sticky xl:top-6">
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
                await refreshEverything()
                setShowAdd(false)
                setAddType(null)
              }}
            />
          </aside>
        </div>
      </div>
    </Container>
  )
}

function isRuntimeReady(profile: DesktopImRuntimeProfile) {
  return ["configured", "enabled", "running", "degraded"].includes(
    profile.effective_state,
  )
}
