"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Plus, Box, Loader2 } from "lucide-react"
import ProviderCard from "./provider-card"
import { type ProviderCard as ProviderCardType } from "@/lib/api/providers"

interface ProviderGridProps {
  providers: ProviderCardType[]
  isLoading: boolean
  searchQuery: string
  onSelect?: (provider: ProviderCardType) => void
}

export default function ProviderGrid({ providers, isLoading, searchQuery, onSelect }: ProviderGridProps) {
  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
        <span className="ml-2 text-[var(--muted)]">Loading providers...</span>
      </div>
    )
  }

  // Empty State
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Box className="h-12 w-12 text-[var(--muted)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
          No providers found
        </h3>
        <p className="text-[var(--muted)] max-w-md">
          {searchQuery 
            ? `No providers match "${searchQuery}". Try adjusting your search or category filter.`
            : "No providers available in this category."
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
        <button className="w-full h-full min-h-[220px] rounded-2xl border-2 border-dashed border-[var(--muted)]/30 hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/5 transition-all duration-300 flex flex-col items-center justify-center gap-3 group text-[var(--muted)] hover:text-[var(--primary)] cursor-pointer">
          <div className="size-12 rounded-full bg-[var(--surface)]/80 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm border border-white/10">
            <Plus className="size-6" />
          </div>
          <span className="font-medium">Request Provider</span>
        </button>
      </motion.div>
    </div>
  )
}
