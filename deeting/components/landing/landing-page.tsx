"use client"

import { useTranslations } from "next-intl"
import { LandingHero } from "./hero-mockup"
import { FeatureBento } from "./feature-bento"

export function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#05050A] text-foreground overflow-x-hidden selection:bg-blue-500/30">
      
      {/* Hero Section with 3D Mockup */}
      <LandingHero />

      {/* Feature Grid */}
      <FeatureBento />

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 bg-black/20 backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
           <div className="text-sm text-gray-500">
              © 2026 Deeting Inc. Privacy First AI.
           </div>
           <div className="flex gap-6 text-sm text-gray-500">
              <a href="#" className="hover:text-white transition-colors">GitHub</a>
              <a href="#" className="hover:text-white transition-colors">Twitter</a>
              <a href="#" className="hover:text-white transition-colors">Docs</a>
           </div>
        </div>
      </footer>

    </div>
  )
}