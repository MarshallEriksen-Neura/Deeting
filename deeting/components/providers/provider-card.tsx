"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Globe, Cpu, Box, Terminal, ArrowRight } from "lucide-react"
import { Icon } from "@iconify/react"
import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { type ProviderCard as ProviderCardType } from "@/lib/api/providers"

interface ProviderCardProps {
  provider: ProviderCardType
  index: number
  onSelect?: (provider: ProviderCardType) => void
}

export default function ProviderCard({ provider, index, onSelect }: ProviderCardProps) {
  // Get theme color or default
  const themeColor = provider.theme_color || "#6b7280"
  
  // Convert hex to RGB for shadow
  const hexToRgb = React.useCallback((hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 107, g: 116, b: 139 }
  }, [])
  
  const rgb = React.useMemo(() => hexToRgb(themeColor), [themeColor, hexToRgb])
  const shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`

  const category = (provider.category || "").toLowerCase()
  const DefaultIcon = category.includes("cloud")
    ? Globe
    : category.includes("local")
    ? Terminal
    : category.includes("custom")
    ? Box
    : Cpu

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      onClick={() => onSelect?.(provider)}
      className="cursor-pointer"
    >
      <GlassCard 
        className="group relative h-full flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer overflow-hidden backdrop-blur-md bg-white/40 dark:bg-black/40 border-white/20"
        padding="lg"
      >
        {/* Background Gradient Effect on Hover */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 pointer-events-none"
          style={{
            background: `linear-gradient(135deg, ${themeColor}20 0%, transparent 100%)`
          }}
        />

        <div className="flex flex-col h-full gap-4">
          <div className="flex justify-between items-start">
            <div 
              className="size-14 rounded-2xl flex items-center justify-center shadow-lg ring-1 ring-white/10 group-hover:scale-110 transition-all duration-300 text-white"
              style={{
                backgroundColor: themeColor,
                boxShadow: `0 4px 15px -3px ${shadowColor}`
              }}
            >
              {provider.icon ? (
                <Icon icon={provider.icon} className="size-8" />
              ) : (
                <DefaultIcon className="size-8" />
              )}
            </div>
            
            <div className="flex flex-col gap-1">
              {provider.is_popular && (
                <Badge variant="secondary" className="bg-[var(--surface)] text-xs font-normal opacity-80 backdrop-blur-sm">
                  POPULAR
                </Badge>
              )}
              {provider.connected && (
                <Badge variant="default" className="bg-green-500/20 text-green-400 text-xs font-normal border-green-500/30">
                  CONNECTED
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">
              {provider.name}
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              {provider.description || "No description available"}
            </p>
            
            {/* Tags */}
            {provider.tags && provider.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {provider.tags.slice(0, 3).map((tag) => (
                  <span 
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--surface)]/50 text-[var(--muted-foreground)] border border-[var(--border)]/30"
                  >
                    {tag}
                  </span>
                ))}
                {provider.tags.length > 3 && (
                  <span className="text-xs text-[var(--muted)]">
                    +{provider.tags.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 flex items-center justify-between border-t border-[var(--border)]/30">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)]/50">
              {provider.category}
            </span>
            
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
              {provider.connected ? "Manage" : "Connect"} <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Instance count indicator */}
          {provider.instances && provider.instances.length > 0 && (
            <div className="absolute top-3 right-3 size-6 rounded-full bg-[var(--primary)] text-white text-xs font-bold flex items-center justify-center">
              {provider.instances.length}
            </div>
          )}
        </div>
      </GlassCard>
    </motion.div>
  )
}
