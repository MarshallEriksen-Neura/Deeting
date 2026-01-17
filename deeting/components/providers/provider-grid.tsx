"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Plus, Box, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import ProviderCard from "./provider-card"
import { type ProviderCard as ProviderCardType } from "@/lib/api/providers"

interface ProviderGridProps {
  providers: ProviderCardType[]
  isLoading: boolean
  searchQuery: string
  onSelect?: (provider: ProviderCardType) => void
}

export default function ProviderGrid({ providers, isLoading, searchQuery, onSelect }: ProviderGridProps) {
  const t = useTranslations("providers.market")
  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
        <span className="ml-2 text-[var(--muted)]">{t("grid.loading")}</span>
      </div>
    )
  }

  // Empty State
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Box className="h-12 w-12 text-[var(--muted)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
          {t("grid.emptyTitle")}
        </h3>
        <p className="text-[var(--muted)] max-w-md">
          {searchQuery 
            ? t("grid.emptyNoMatch", { query: searchQuery })
            : t("grid.emptyNoCategory")
          }
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {providers.map((provider, index) => (
        <ProviderCard key={provider.slug} provider={provider} index={index} onSelect={onSelect} />
      ))}
      
      {/* Request New Provider Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: providers.length * 0.05 + 0.1 }}
      > 
        <Button
          type="button"
          variant="ghost"
          className="w-full h-full min-h-[220px] rounded-2xl border border-dashed border-[var(--border)]/50 bg-[var(--surface)]/40 backdrop-blur-sm transition-all duration-300 ease-out flex flex-col items-center justify-center gap-3 group text-[var(--muted)] hover:text-[var(--primary)] hover:-translate-y-0.5 hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/5 hover:shadow-[0_8px_24px_-12px_rgba(37,99,235,0.25)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
        >
          <div className="size-12 rounded-full bg-[var(--surface)]/70 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm border border-white/10">
            <Plus className="size-6" />
          </div>
          <span className="font-medium">{t("grid.requestProvider")}</span>
        </Button>
      </motion.div>
    </div>
  )
}
