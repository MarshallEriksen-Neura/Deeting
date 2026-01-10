"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Copy, Check, AlertTriangle, Lock, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { GlassButton } from "@/components/ui/glass-button"

interface KeyRevealModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  secret: string | null
  keyName?: string
}

/**
 * KeyRevealModal - Show-once modal for displaying the full API key secret
 *
 * Design features:
 * - Dark, high-contrast key display
 * - Large monospace font for easy reading
 * - Prominent copy button with success feedback
 * - Confetti/sparkle effect on successful copy
 * - Security warning with visual prominence
 * - "Shutter" close animation (CSS-based)
 */
export function KeyRevealModal({
  open,
  onOpenChange,
  secret,
  keyName,
}: KeyRevealModalProps) {
  const t = useTranslations("apiKeys.reveal")
  const [copied, setCopied] = React.useState(false)
  const [showConfetti, setShowConfetti] = React.useState(open)

  const handleCopy = async () => {
    if (!secret) return

    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setShowConfetti(true)

      // Reset states after animation
      setTimeout(() => setCopied(false), 3000)
      setTimeout(() => setShowConfetti(false), 1500)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const handleClose = () => {
    // Small delay to allow user to see they can close it
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-xl",
          "bg-[var(--card)]/95 backdrop-blur-2xl",
          "border border-white/10",
          "overflow-hidden"
        )}
      >
        {/* Confetti effect */}
        {showConfetti && <ConfettiEffect />}

        <DialogHeader className="space-y-4 text-center pb-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/20">
            <Sparkles className="size-8 text-emerald-500" />
          </div>
          <DialogTitle className="text-2xl font-bold">
            {t("title")}
          </DialogTitle>
          {keyName && (
            <DialogDescription className="text-base">
              <span className="font-medium text-[var(--foreground)]">{keyName}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Key display area */}
        <div className="my-4">
          <div
            className={cn(
              "relative rounded-xl overflow-hidden",
              "bg-zinc-900/90 border border-zinc-700",
              "p-4"
            )}
          >
            {/* Glowing top edge */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.5) 50%, transparent)",
              }}
            />

            <div className="flex items-center gap-3">
              <Lock className="size-5 text-zinc-500 flex-shrink-0" />
              <code
                className={cn(
                  "flex-1 font-mono text-sm md:text-base",
                  "text-emerald-400 break-all leading-relaxed",
                  "select-all"
                )}
              >
                {secret}
              </code>
            </div>

            {/* Copy button */}
            <div className="mt-4 flex justify-end">
              <GlassButton
                variant={copied ? "success" : "default"}
                onClick={handleCopy}
                className={cn(
                  "min-w-[120px]",
                  "transition-all duration-300",
                  copied && "scale-105"
                )}
              >
                {copied ? (
                  <>
                    <Check className="size-4" />
                    {t("copied")}
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    {t("copyKey")}
                  </>
                )}
              </GlassButton>
            </div>
          </div>

          {/* Warning message */}
          <div
            className={cn(
              "mt-4 flex items-start gap-3 rounded-xl p-4",
              "bg-amber-500/10 border border-amber-500/20"
            )}
          >
            <AlertTriangle className="size-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-500">
                {t("warning")}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t("securityNote")}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <GlassButton
            variant="secondary"
            onClick={handleClose}
            className="w-full"
          >
            {t("done")}
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Simple confetti effect using CSS animations
 * Uses pre-computed values to avoid impure Math.random() in render
 */
const CONFETTI_PARTICLES = [
  { id: 0, x: 12, delay: 0.1, duration: 0.9, color: "bg-emerald-400", size: 5 },
  { id: 1, x: 25, delay: 0.2, duration: 1.1, color: "bg-[var(--primary)]", size: 6 },
  { id: 2, x: 38, delay: 0.05, duration: 0.85, color: "bg-amber-400", size: 4 },
  { id: 3, x: 50, delay: 0.15, duration: 1.0, color: "bg-teal-400", size: 7 },
  { id: 4, x: 62, delay: 0.3, duration: 0.95, color: "bg-pink-400", size: 5 },
  { id: 5, x: 75, delay: 0.08, duration: 1.15, color: "bg-emerald-400", size: 6 },
  { id: 6, x: 88, delay: 0.22, duration: 0.9, color: "bg-[var(--primary)]", size: 4 },
  { id: 7, x: 8, delay: 0.18, duration: 1.05, color: "bg-amber-400", size: 7 },
  { id: 8, x: 32, delay: 0.35, duration: 0.8, color: "bg-teal-400", size: 5 },
  { id: 9, x: 45, delay: 0.12, duration: 1.2, color: "bg-pink-400", size: 6 },
  { id: 10, x: 58, delay: 0.28, duration: 0.88, color: "bg-emerald-400", size: 4 },
  { id: 11, x: 72, delay: 0.42, duration: 1.0, color: "bg-[var(--primary)]", size: 7 },
  { id: 12, x: 85, delay: 0.05, duration: 0.95, color: "bg-amber-400", size: 5 },
  { id: 13, x: 15, delay: 0.25, duration: 1.1, color: "bg-teal-400", size: 6 },
  { id: 14, x: 28, delay: 0.38, duration: 0.85, color: "bg-pink-400", size: 4 },
  { id: 15, x: 42, delay: 0.15, duration: 1.15, color: "bg-emerald-400", size: 7 },
  { id: 16, x: 55, delay: 0.32, duration: 0.9, color: "bg-[var(--primary)]", size: 5 },
  { id: 17, x: 68, delay: 0.08, duration: 1.0, color: "bg-amber-400", size: 6 },
  { id: 18, x: 82, delay: 0.45, duration: 0.92, color: "bg-teal-400", size: 4 },
  { id: 19, x: 95, delay: 0.2, duration: 1.08, color: "bg-pink-400", size: 7 },
]

function ConfettiEffect() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI_PARTICLES.map((particle) => (
        <div
          key={particle.id}
          className={cn(
            "absolute rounded-full",
            particle.color,
            "animate-confetti"
          )}
          style={{
            left: `${particle.x}%`,
            top: "50%",
            width: particle.size,
            height: particle.size,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
          }}
        />
      ))}

      <style jsx>{`
        @keyframes confetti {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(-200px) rotate(720deg) scale(0);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti ease-out forwards;
        }
      `}</style>
    </div>
  )
}

export default KeyRevealModal
