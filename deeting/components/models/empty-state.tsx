"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Radar, RefreshCw, Satellite, Signal } from "lucide-react"

import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"

/**
 * ModelEmptyState - Empty State with Radar Animation
 *
 * Shown when a provider has been added but no models have been synced yet.
 * Features a radar scanning animation to suggest "deep scan" action.
 */

interface ModelEmptyStateProps {
  onSync: () => void
  isSyncing?: boolean
  providerName?: string
  className?: string
}

// Radar scan animation
function RadarAnimation() {
  return (
    <div className="relative size-32">
      {/* Outer rings */}
      {[1, 2, 3].map((ring) => (
        <motion.div
          key={ring}
          className="absolute inset-0 rounded-full border border-[var(--primary)]/20"
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: [0, 0.5, 0] }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            delay: ring * 0.5,
            ease: "easeOut",
          }}
        />
      ))}

      {/* Static rings */}
      <div className="absolute inset-0 rounded-full border border-[var(--primary)]/10" />
      <div className="absolute inset-4 rounded-full border border-[var(--primary)]/10" />
      <div className="absolute inset-8 rounded-full border border-[var(--primary)]/10" />

      {/* Sweep line */}
      <motion.div
        className="absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      >
        <div
          className="absolute top-1/2 left-1/2 w-1/2 h-0.5 origin-left"
          style={{
            background: "linear-gradient(90deg, var(--primary), transparent)",
          }}
        />
        {/* Sweep trail */}
        <div
          className="absolute top-1/2 left-1/2 w-1/2 h-8 origin-left -translate-y-4"
          style={{
            background: "conic-gradient(from 0deg, transparent, var(--primary)/10, transparent)",
            clipPath: "polygon(0% 50%, 100% 0%, 100% 100%)",
          }}
        />
      </motion.div>

      {/* Center dot */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-4 rounded-full bg-[var(--primary)]"
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(124, 109, 255, 0.4)",
            "0 0 0 8px rgba(124, 109, 255, 0)",
          ],
        }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />

      {/* Blips */}
      {[
        { x: 20, y: 40, delay: 0.5 },
        { x: 80, y: 25, delay: 1.2 },
        { x: 60, y: 75, delay: 2.0 },
      ].map((blip, i) => (
        <motion.div
          key={i}
          className="absolute size-2 rounded-full bg-[var(--primary)]"
          style={{ left: `${blip.x}%`, top: `${blip.y}%` }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: blip.delay,
          }}
        />
      ))}
    </div>
  )
}

// Scanning state animation
function ScanningAnimation() {
  return (
    <div className="relative size-32 flex items-center justify-center">
      {/* Pulsing rings */}
      {[1, 2, 3].map((ring) => (
        <motion.div
          key={ring}
          className="absolute rounded-full border-2 border-[var(--primary)]"
          style={{
            width: `${30 + ring * 20}%`,
            height: `${30 + ring * 20}%`,
          }}
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: ring * 0.2,
          }}
        />
      ))}

      {/* Satellite icon */}
      <motion.div
        animate={{ rotate: [0, 10, -10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-[var(--primary)]"
      >
        <Satellite className="size-10" />
      </motion.div>

      {/* Signal waves */}
      <motion.div
        className="absolute -right-2 top-1/2 -translate-y-1/2"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1, repeat: Infinity }}
      >
        <Signal className="size-6 text-[var(--primary)]" />
      </motion.div>
    </div>
  )
}

export function ModelEmptyState({
  onSync,
  isSyncing = false,
  providerName = "this provider",
  className,
}: ModelEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col items-center justify-center py-16 px-8 text-center",
        className
      )}
    >
      {/* Animation */}
      <div className="mb-8">
        {isSyncing ? <ScanningAnimation /> : <RadarAnimation />}
      </div>

      {/* Text Content */}
      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-xl font-semibold text-[var(--foreground)] mb-2"
      >
        {isSyncing ? "Scanning for Models..." : "No Models Detected Yet"}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-sm text-[var(--muted)] max-w-[320px] mb-6"
      >
        {isSyncing
          ? `Connecting to ${providerName} and fetching available models. This may take a moment.`
          : `Connect to ${providerName} and sync the model catalog to see available AI models.`}
      </motion.p>

      {/* Action Button */}
      {!isSyncing && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
        >
          <GlassButton onClick={onSync} size="lg" className="gap-2">
            <Radar className="size-5" />
            Initiate Deep Scan
          </GlassButton>
        </motion.div>
      )}

      {/* Syncing progress text */}
      {isSyncing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <RefreshCw className="size-4" />
          </motion.div>
          Fetching model catalog...
        </motion.div>
      )}
    </motion.div>
  )
}

export default ModelEmptyState
