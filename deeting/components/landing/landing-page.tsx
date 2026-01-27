"use client"

import { useTranslations } from "next-intl"
import { LandingHero } from "./hero-mockup"
import { FeatureBento } from "./feature-bento"

export function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-blue-500/30">

      {/* Hero Section with 3D Mockup */}
      <LandingHero />

      {/* Feature Grid */}
      <FeatureBento />

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-surface backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="text-sm text-muted-foreground">
              © 2026 Deeting Inc. Privacy First AI.
           </div>
           <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">GitHub</a>
              <a href="#" className="hover:text-foreground transition-colors">Twitter</a>
              <a href="#" className="hover:text-foreground transition-colors">Docs</a>
           </div>
        </div>
      </footer>

    </div>
  )
}