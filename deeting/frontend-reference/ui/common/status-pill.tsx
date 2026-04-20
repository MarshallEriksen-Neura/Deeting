import { cn } from "@/lib/utils"

type StatusPillTone = "default" | "subtle" | "info" | "success" | "warn" | "error"

interface StatusPillProps {
  text: string
  className?: string
  tone?: StatusPillTone
  size?: "xs" | "sm"
  isLoading?: boolean
}

export function StatusPill({
  text,
  className,
  tone = "subtle",
  size = "xs",
  isLoading = false,
}: StatusPillProps) {
  const sizeClass = size === "sm" ? "text-[10px] px-2.5 py-0.5" : "text-[9px] px-2 py-0.5"
  const toneClass =
    tone === "info"
      ? "text-blue-600/70 dark:text-blue-300/70 bg-blue-50/70 dark:bg-blue-500/10 border-blue-200/70 dark:border-blue-400/20"
      : tone === "success"
      ? "text-emerald-600/70 dark:text-emerald-300/70 bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-400/20"
      : tone === "warn"
      ? "text-amber-600/70 dark:text-amber-300/70 bg-amber-50/70 dark:bg-amber-500/10 border-amber-200/70 dark:border-amber-400/20"
      : tone === "error"
      ? "text-rose-600/70 dark:text-rose-300/70 bg-rose-50/70 dark:bg-rose-500/10 border-rose-200/70 dark:border-rose-400/20"
      : tone === "default"
      ? "text-black/60 dark:text-white/60 bg-black/5 dark:bg-white/10 border-black/5 dark:border-white/10"
      : "text-black/50 dark:text-white/50 bg-black/5 dark:bg-white/10 border-black/5 dark:border-white/10"
  const motionClass = isLoading ? "animate-pulse" : ""

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium leading-none truncate",
        sizeClass,
        toneClass,
        motionClass,
        className
      )}
    >
      {text}
    </span>
  )
}
