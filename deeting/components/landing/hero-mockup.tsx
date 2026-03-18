"use client"

import { motion } from "framer-motion"
import { ArrowRight, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { HeroDemo } from "./hero-demo"

export function LandingHero() {
  const t = useTranslations("home.hero")

  return (
    <div className="relative min-h-[90vh] flex flex-col justify-center overflow-hidden">

      {/* Background ambient glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[10%] right-[-5%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-[40%] left-[50%] w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" style={{ opacity: 0.05 }} />

      <div className="container mx-auto px-6 relative z-10 pt-20">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">

          {/* Left side: Brand + CTA */}
          <div className="lg:w-1/2 space-y-8 text-center lg:text-left relative">
            {/* Decorative glow */}
            <div className="absolute -left-20 top-0 w-40 h-40 bg-blue-500/20 blur-3xl rounded-full pointer-events-none" />

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/50 border border-border backdrop-blur-md text-xs font-medium text-primary shadow-lg shadow-primary/10"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              {t("badge")}
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]"
            >
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
                Deeting
              </span>
              <br />
              <span className="text-foreground drop-shadow-2xl text-4xl lg:text-5xl">
                {t("title")}
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed font-light"
            >
              {t("descriptionLine1")}
              <br className="hidden lg:block" />
              {t("descriptionLine2")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
            >
              {/* Primary CTA */}
              <Link href="/chat" className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-75 transition duration-200"></div>
                <Button className="relative w-full sm:w-auto px-8 py-4 h-auto rounded-xl font-bold text-base shadow-xl">
                  <Sparkles className="w-5 h-5" />
                  {t("primaryCta")}
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
                </Button>
              </Link>

              {/* Secondary CTA */}
              <a href="#features">
                <Button variant="outline" className="w-full sm:w-auto px-8 py-4 h-auto rounded-xl font-medium backdrop-blur-sm">
                  {t("secondaryCta")}
                </Button>
              </a>
            </motion.div>

            {/* Trust badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="pt-6 flex flex-wrap items-center justify-center lg:justify-start gap-4 text-muted-foreground text-xs"
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/30 border border-border/50">
                <div className="size-1.5 rounded-full bg-emerald-500" />
                {t("trust.privacyFirst")}
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/30 border border-border/50">
                <div className="size-1.5 rounded-full bg-blue-500" />
                {t("trust.localModels")}
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/30 border border-border/50">
                <div className="size-1.5 rounded-full bg-amber-500" />
                {t("trust.zeroLatency")}
              </div>
            </motion.div>
          </div>

          {/* Right side: Hero Demo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
            className="lg:w-1/2 relative"
          >
            {/* Decorative glow ring */}
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 to-purple-500/10 rounded-[2rem] blur-3xl transform rotate-3 scale-105 pointer-events-none" />

            <HeroDemo />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
