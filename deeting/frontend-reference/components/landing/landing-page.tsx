"use client"

import { useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"
import { LandingHero } from "./hero-mockup"
import { FeatureBento } from "./feature-bento"

export function LandingPage() {
  const t = useTranslations("home.footer")

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-blue-500/30">

      {/* Hero Section with Agent Demo */}
      <LandingHero />

      {/* Feature Grid */}
      <FeatureBento />

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-surface backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="text-sm text-muted-foreground">
              {t("tagline")}
           </div>
           <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="https://github.com/MarshallEriksen-Neura/Deeting" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">{t("github")}</a>
              <a href="#" className="hover:text-foreground transition-colors">{t("twitter")}</a>
              <Link href="/docs" className="hover:text-foreground transition-colors">{t("docs")}</Link>
           </div>
        </div>
      </footer>

    </div>
  )
}
