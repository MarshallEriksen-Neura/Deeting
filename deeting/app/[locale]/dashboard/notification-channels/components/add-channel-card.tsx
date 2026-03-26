"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { cn } from "@/lib/utils"
import type { ChannelConfig, ChannelType } from "@/lib/api/notification-channels"
import { CHANNEL_META } from "@/lib/api/notification-channels"
import { CHANNEL_ICONS } from "./channel-shared"
import { ChannelConfigForm } from "./channel-config-form"

export function AddChannelCard({
  showAdd,
  addType,
  availableTypes,
  onShowAdd,
  onCancelAdd,
  onSelectType,
  onResetType,
  onCreate,
}: {
  showAdd: boolean
  addType: ChannelType | null
  availableTypes: ChannelType[]
  onShowAdd: () => void
  onCancelAdd: () => void
  onSelectType: (channelType: ChannelType) => void
  onResetType: () => void
  onCreate: (channelType: ChannelType, config: ChannelConfig, displayName: string) => Promise<void>
}) {
  const t = useTranslations("dashboard.notificationChannelsPage")

  if (availableTypes.length === 0) {
    return null
  }

  return (
    <div className="mt-6">
      {!showAdd ? (
        <GlassButton
          type="button"
          variant="secondary"
          onClick={onShowAdd}
          className="flex h-12 w-full items-center justify-center gap-2 border border-dashed border-white/10 text-sm text-[var(--muted)] hover:border-[var(--primary)]/30 hover:text-[var(--primary)] hover:bg-[var(--primary)]/[0.03]"
        >
          <Plus className="h-4 w-4" />
          {t("actions.addChannel")}
        </GlassButton>
      ) : (
        <GlassCard padding="default" hover="none">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {t("actions.selectType")}
            </span>
            <GlassButton type="button" size="sm" variant="ghost" onClick={onCancelAdd}>
              {t("actions.cancel")}
            </GlassButton>
          </div>

          <div className="mb-4 grid grid-cols-5 gap-2">
            {availableTypes.map((type) => {
              const Icon = CHANNEL_ICONS[type]
              const meta = CHANNEL_META[type]
              return (
                <GlassButton
                  key={type}
                  type="button"
                  variant={addType === type ? "secondary" : "ghost"}
                  onClick={() => onSelectType(type)}
                  className={cn(
                    "h-auto flex-col gap-1.5 rounded-xl border px-2 py-3 text-center",
                    addType === type
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                      : "border-white/5 bg-[var(--foreground)]/[0.02] hover:border-white/10 hover:bg-[var(--foreground)]/[0.05]"
                  )}
                >
                  <Icon className={cn("h-5 w-5", meta.color)} />
                  <span className="text-[11px] font-medium text-[var(--foreground)]">
                    {t(`channelTypes.${type}.label`)}
                  </span>
                </GlassButton>
              )
            })}
          </div>

          <AnimatePresence mode="wait">
            {addType ? (
              <motion.div
                key={addType}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChannelConfigForm
                  channelType={addType}
                  onSave={async (config, displayName) => onCreate(addType, config, displayName)}
                  onCancel={onResetType}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </GlassCard>
      )}
    </div>
  )
}
