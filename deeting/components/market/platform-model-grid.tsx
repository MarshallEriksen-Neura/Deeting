"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Box, Loader2, Coins } from "lucide-react"
import { useTranslations } from "next-intl"
import { Icon } from "@iconify/react"
import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { usePlatformModels } from "@/lib/swr/use-platform-models"
import type { CreditsPlatformModel } from "@/lib/api/credits"

interface PlatformModelGridProps {
  onSelect?: (model: CreditsPlatformModel) => void
}

export function PlatformModelGrid({ onSelect }: PlatformModelGridProps) {
  const t = useTranslations("providers.market")
  const { models, isLoading } = usePlatformModels()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
        <span className="ml-2 text-[var(--muted)]">{t("platform.loading")}</span>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Box className="h-12 w-12 text-[var(--muted)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
          {t("platform.emptyTitle")}
        </h3>
        <p className="text-[var(--muted)] max-w-md">
          {t("platform.emptyDescription")}
        </p>
      </div>
    )
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, CreditsPlatformModel[]>()
    for (const m of models) {
      const key = m.provider_slug || "unknown"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries())
  }, [models])

  return (
    <div className="space-y-8">
      {grouped.map(([slug, groupModels]) => {
        const first = groupModels[0]
        return (
          <div key={slug} className="space-y-4">
            <div className="flex items-center gap-3">
              {first.provider_icon && (
                <Icon icon={first.provider_icon} className="h-5 w-5" style={{ color: first.provider_color || undefined }} />
              )}
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {first.provider_name || slug}
              </h3>
              <Badge variant="secondary" className="text-xs">
                {groupModels.length} {groupModels.length === 1 ? "model" : "models"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {groupModels.map((model, index) => (
                <PlatformModelCard
                  key={model.id}
                  model={model}
                  index={index}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlatformModelCard({
  model,
  index,
  onSelect,
}: {
  model: CreditsPlatformModel
  index: number
  onSelect?: (model: CreditsPlatformModel) => void
}) {
  const t = useTranslations("providers.market")
  const pricing = model.pricing as Record<string, unknown> | undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      onClick={() => onSelect?.(model)}
      className="cursor-pointer"
    >
      <GlassCard
        className="group relative flex flex-col gap-3 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 backdrop-blur-md bg-white/40 dark:bg-black/40 border-white/20"
        padding="md"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm text-[var(--foreground)] truncate">
              {model.display_name || model.model_id}
            </p>
            <p className="text-xs text-[var(--muted)] truncate mt-0.5">
              {model.model_id}
            </p>
          </div>
          {model.provider_icon && (
            <Icon
              icon={model.provider_icon}
              className="h-4 w-4 shrink-0"
              style={{ color: model.provider_color || undefined }}
            />
          )}
        </div>

        {pricing && (pricing.input_per_1k || pricing.output_per_1k) && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Coins className="h-3 w-3 text-amber-500" />
            <span>
              {pricing.input_per_1k ? `${t("platform.inputPrice", { price: String(pricing.input_per_1k) })}` : ""}
              {pricing.input_per_1k && pricing.output_per_1k ? " · " : ""}
              {pricing.output_per_1k ? `${t("platform.outputPrice", { price: String(pricing.output_per_1k) })}` : ""}
            </span>
          </div>
        )}

        {model.capabilities && model.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {model.capabilities.slice(0, 3).map((cap) => (
              <Badge
                key={cap}
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-white/10"
              >
                {cap}
              </Badge>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}
