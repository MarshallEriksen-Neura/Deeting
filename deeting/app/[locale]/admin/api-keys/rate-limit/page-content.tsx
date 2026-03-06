"use client"

import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function PageContent() {
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
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rateLimits.map((rl) => (
          <GlassCard key={rl.label} padding="default" hover="lift">
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--foreground)]">{rl.label}</h4>
                <p className="text-xs text-[var(--muted)]">{rl.description}</p>
              </div>
              <Input
                type="number"
                defaultValue={rl.value}
                className="font-mono"
              />
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("ipWhitelist.title")}</h3>
          <Button variant="outline" size="sm">
            {t("ipWhitelist.addIp")}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-medium uppercase tracking-wider">{t("ipWhitelist.columns.pattern")}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">{t("ipWhitelist.columns.description")}</TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider">{t("ipWhitelist.columns.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ipWhitelist.map((ip) => (
              <TableRow key={ip.pattern}>
                <TableCell className="font-mono text-xs">{ip.pattern}</TableCell>
                <TableCell className="text-xs text-[var(--muted)]">{ip.description}</TableCell>
                <TableCell className="text-right">
                  <Button variant="link" size="sm" className="text-rose-400">
                    {t("ipWhitelist.remove")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>

      <div className="flex justify-end">
        <Button>
          {t("saveChanges")}
        </Button>
      </div>
    </>
  )
}
