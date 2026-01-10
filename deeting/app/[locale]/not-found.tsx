import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { Compass, Sparkles, ArrowLeft } from "lucide-react"

import { Container } from "@/components/ui/container"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardTitle,
} from "@/components/ui/glass-card"

export default async function NotFound() {
  const t = await getTranslations("common")
  const locale = await getLocale()

  return (
    <div className="relative isolate min-h-[calc(100vh-120px)] overflow-hidden bg-[var(--background)] py-14">
      {/* Ink-inspired backdrops */}
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[var(--primary)]/18 blur-3xl" />
        <div className="absolute -bottom-32 right-0 h-96 w-72 rotate-6 rounded-full bg-[var(--teal-accent)]/14 blur-3xl" />
        <div className="absolute inset-x-12 top-32 h-[1px] bg-gradient-to-r from-transparent via-[var(--primary)]/30 to-transparent" />
      </div>

      <Container className="relative z-10">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-10 text-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/40 bg-white/60 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)] backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.4)]">
            <Compass className="size-4 text-[var(--primary)]" />
            404 · {t("notFound.hint")}
          </div>

          <GlassCard
            blur="xl"
            padding="lg"
            hover="none"
            className="w-full max-w-2xl shadow-[0_24px_80px_-28px_rgba(0,0,0,0.25)]"
          >
            <GlassCardContent className="space-y-6">
              <div className="flex flex-col gap-2">
                <GlassCardTitle className="text-3xl leading-tight">
                  {t("notFound.title")}
                </GlassCardTitle>
                <GlassCardDescription className="text-base leading-relaxed">
                  {t("notFound.description")}
                </GlassCardDescription>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <GlassButton asChild className="min-w-[140px]">
                  <Link href={`/${locale}`}>
                    <ArrowLeft className="size-4" />
                    {t("notFound.backHome")}
                  </Link>
                </GlassButton>
                <GlassButton asChild variant="secondary" className="min-w-[140px]">
                  <Link href="mailto:admin@higress.ai">
                    <Sparkles className="size-4 text-[var(--primary)]" />
                    {t("notFound.contact")}
                  </Link>
                </GlassButton>
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>
      </Container>
    </div>
  )
}
