"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertCircle, RefreshCcw, ArrowLeft } from "lucide-react"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardTitle,
} from "@/components/ui/glass-card"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <ThemeProvider defaultTheme="system" enableSystem>
          <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] px-6">
            {/* Atmospheric backdrops */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-16 -top-20 h-72 w-72 rounded-full bg-[var(--primary)]/18 blur-3xl" />
              <div className="absolute right-[-40px] top-12 h-80 w-64 rounded-full bg-[var(--teal-accent)]/16 blur-3xl" />
              <div className="absolute inset-x-10 bottom-16 h-[1px] bg-gradient-to-r from-transparent via-[var(--primary)]/25 to-transparent" />
            </div>

            <div className="relative z-10 w-full max-w-xl space-y-5">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/40 bg-white/60 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)] backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.4)]">
                <AlertCircle className="size-4 text-red-400" />
                System Error
              </div>

              <GlassCard
                blur="xl"
                hover="none"
                padding="lg"
                className="shadow-[0_28px_96px_-28px_rgba(0,0,0,0.35)]"
              >
                <GlassCardContent className="space-y-5">
                  <div className="space-y-2">
                    <GlassCardTitle className="text-3xl leading-tight">
                      系统出现波动
                    </GlassCardTitle>
                    <GlassCardDescription className="text-base leading-relaxed">
                      我们正在平复涟漪，请稍后再试。If the issue persists, please retry or head back home.
                    </GlassCardDescription>
                  </div>

                  {error?.message && (
                    <div className="rounded-xl border border-white/15 bg-white/60 px-4 py-3 text-sm text-[var(--foreground)] shadow-inner backdrop-blur">
                      <span className="text-[var(--muted)]">错误详情：</span>
                      <span className="font-medium">{error.message}</span>
                      {error.digest && (
                        <span className="ml-2 text-xs text-[var(--muted)]">[{error.digest}]</span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <GlassButton className="min-w-[120px]" onClick={reset}>
                      <RefreshCcw className="size-4" />
                      重试
                    </GlassButton>
                    <GlassButton asChild variant="secondary" className="min-w-[120px]">
                      <Link href="/">
                        <ArrowLeft className="size-4" />
                        返回首页
                      </Link>
                    </GlassButton>
                  </div>
                </GlassCardContent>
              </GlassCard>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
