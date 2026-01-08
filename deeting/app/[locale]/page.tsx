import { useTranslations } from "next-intl"
import { Container } from "@/components/ui/container"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
  GlassCardFooter,
  GlassStatCard,
} from "@/components/ui/glass-card"
import { Activity, Zap, Shield, Settings, ArrowRight, Sparkles } from "lucide-react"

export default function HomePage() {
  const tCommon = useTranslations("common")
  const tStats = useTranslations("stats")
  const tCards = useTranslations("cards")
  const tButtons = useTranslations("buttons")

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Main Content */}
      <Container as="main" className="py-8" gutter="md">
        {/* Hero Section */}
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div
            className="mb-6 size-16 rounded-2xl"
            style={{ background: "var(--gradient)" }}
          />
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-[var(--foreground)]">
            {tCommon("brand")}
          </h1>
          <p className="mb-8 max-w-lg text-lg text-[var(--muted)]">
            {tCommon("subtitle")}
          </p>

          {/* Button Demo */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <GlassButton>
              <Sparkles className="size-4" />
              {tCommon("getStarted")}
            </GlassButton>
            <GlassButton variant="secondary">
              {tCommon("docs")}
            </GlassButton>
            <GlassButton variant="outline">
              {tCommon("viewDemo")}
            </GlassButton>
            <GlassButton variant="ghost">
              {tCommon("learnMore")}
              <ArrowRight className="size-4" />
            </GlassButton>
          </div>
        </div>

        {/* Stats Cards - Using GlassStatCard */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-semibold text-[var(--foreground)]">
            {tStats("title")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <GlassStatCard
              label={tStats("totalRoutes")}
              value="128"
              trend={{ value: 12, isPositive: true }}
              icon={<Activity className="size-5" />}
              className="animate-glass-card-in stagger-1"
            />
            <GlassStatCard
              label={tStats("activeServices")}
              value="24"
              trend={{ value: 8, isPositive: true }}
              icon={<Zap className="size-5" />}
              theme="primary"
              className="animate-glass-card-in stagger-2"
            />
            <GlassStatCard
              label={tStats("securityRules")}
              value="56"
              trend={{ value: 3, isPositive: false }}
              icon={<Shield className="size-5" />}
              theme="teal"
              className="animate-glass-card-in stagger-3"
            />
            <GlassStatCard
              label={tStats("activePlugins")}
              value="12"
              icon={<Settings className="size-5" />}
              className="animate-glass-card-in stagger-4"
            />
          </div>
        </section>

        {/* Glass Cards Demo */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-semibold text-[var(--foreground)]">
            {tCards("ios")}
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Default Card */}
            <GlassCard className="animate-glass-card-in stagger-1">
              <GlassCardHeader>
                <GlassCardTitle>{tCards("defaultTitle")}</GlassCardTitle>
                <GlassCardDescription>
                  {tCards("defaultDesc")}
                </GlassCardDescription>
              </GlassCardHeader>
              <GlassCardContent>
                <p className="text-sm text-[var(--muted)]">
                  {tCards("defaultBody")}
                </p>
              </GlassCardContent>
              <GlassCardFooter>
                <GlassButton size="sm">{tCards("action")}</GlassButton>
                <GlassButton size="sm" variant="ghost">
                  {tCards("cancel")}
                </GlassButton>
              </GlassCardFooter>
            </GlassCard>

            {/* Primary Theme */}
            <GlassCard theme="primary" className="animate-glass-card-in stagger-2">
              <GlassCardHeader>
                <GlassCardTitle>{tCards("primaryTitle")}</GlassCardTitle>
                <GlassCardDescription>
                  {tCards("primaryDesc")}
                </GlassCardDescription>
              </GlassCardHeader>
              <GlassCardContent>
                <p className="text-sm text-[var(--muted)]">
                  {tCards("primaryBody")}
                </p>
              </GlassCardContent>
              <GlassCardFooter>
                <GlassButton size="sm">
                  {tCards("confirm")}
                </GlassButton>
              </GlassCardFooter>
            </GlassCard>

            {/* Teal Theme */}
            <GlassCard theme="teal" hover="glow" className="animate-glass-card-in stagger-3">
              <GlassCardHeader>
                <GlassCardTitle>{tCards("tealTitle")}</GlassCardTitle>
                <GlassCardDescription>
                  {tCards("tealDesc")}
                </GlassCardDescription>
              </GlassCardHeader>
              <GlassCardContent>
                <p className="text-sm text-[var(--muted)]">
                  {tCards("tealBody")}
                </p>
              </GlassCardContent>
              <GlassCardFooter>
                <GlassButton size="sm" variant="teal">
                  {tCards("tealButton")}
                </GlassButton>
              </GlassCardFooter>
            </GlassCard>
          </div>
        </section>

        {/* Button Variants */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-semibold text-[var(--foreground)]">
            {tButtons("variants")}
          </h2>
          <GlassCard blur="lg" padding="lg">
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("primary")}
                </span>
                <GlassButton>{tButtons("primary")}</GlassButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("secondary")}
                </span>
                <GlassButton variant="secondary">{tButtons("secondary")}</GlassButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("outline")}
                </span>
                <GlassButton variant="outline">{tButtons("outline")}</GlassButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("ghost")}
                </span>
                <GlassButton variant="ghost">{tButtons("ghost")}</GlassButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("destructive")}
                </span>
                <GlassButton variant="destructive">{tButtons("destructive")}</GlassButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-[var(--muted)]">
                  {tButtons("success")}
                </span>
                <GlassButton variant="success">{tButtons("success")}</GlassButton>
              </div>
            </div>
          </GlassCard>
        </section>
      </Container>
    </div>
  )
}
