"use client"

import { useTranslations } from "next-intl"
import { Gauge } from "lucide-react"
import { AdminPageShell } from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.rateLimitPage")
  const rateLimits = [
    { label: "RPM", description: t("rateLimits.rpm"), value: 60 },
    { label: "TPM", description: t("rateLimits.tpm"), value: 100000 },
    { label: "RPD", description: t("rateLimits.rpd"), value: 10000 },
    { label: "TPD", description: t("rateLimits.tpd"), value: 2000000 },
    { label: t("rateLimits.concurrentLabel"), description: t("rateLimits.concurrent"), value: 10 },
    { label: t("rateLimits.burstLabel"), description: t("rateLimits.burst"), value: 20 },
  ]
  const ipWhitelist = [
    { pattern: "192.168.1.0/24", description: t("ipWhitelist.officeNetwork") },
    { pattern: "10.0.0.0/8", description: t("ipWhitelist.vpnRange") },
    { pattern: "203.0.113.45", description: t("ipWhitelist.ciServer") },
  ]

  return (
    <AdminPageShell
      title={tAdmin("rateLimit.title")}
      description={tAdmin("rateLimit.description")}
      icon={Gauge}
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rateLimits.map((rl) => (
          <GlassCard key={rl.label} padding="default" hover="lift">
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--foreground)]">{rl.label}</h4>
                <p className="text-xs text-[var(--muted)]">{rl.description}</p>
              </div>
              <input
                type="number"
                defaultValue={rl.value}
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-mono text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/25"
              />
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("ipWhitelist.title")}</h3>
          <button className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--primary)]/10 px-3 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors cursor-pointer">
            {t("ipWhitelist.addIp")}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("ipWhitelist.columns.pattern")}</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("ipWhitelist.columns.description")}</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("ipWhitelist.columns.action")}</th>
            </tr>
          </thead>
          <tbody>
            {ipWhitelist.map((ip) => (
              <tr key={ip.pattern} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-2.5 font-mono text-xs text-[var(--foreground)]">{ip.pattern}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{ip.description}</td>
                <td className="px-3 py-2.5 text-right">
                  <button className="text-xs text-rose-400 hover:underline cursor-pointer">{t("ipWhitelist.remove")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>

      <div className="flex justify-end">
        <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--primary)] px-6 text-sm font-medium text-white hover:opacity-90 transition-opacity cursor-pointer">
          {t("saveChanges")}
        </button>
      </div>
    </AdminPageShell>
  )
}
