"use client"

import { Gauge } from "lucide-react"
import { AdminPageShell } from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"

const rateLimits = [
  { label: "RPM", description: "Requests per minute", value: 60 },
  { label: "TPM", description: "Tokens per minute", value: 100000 },
  { label: "RPD", description: "Requests per day", value: 10000 },
  { label: "TPD", description: "Tokens per day", value: 2000000 },
  { label: "Concurrent", description: "Concurrent requests", value: 10 },
  { label: "Burst", description: "Burst limit", value: 20 },
]

const ipWhitelist = [
  { pattern: "192.168.1.0/24", description: "Office network" },
  { pattern: "10.0.0.0/8", description: "VPN range" },
  { pattern: "203.0.113.45", description: "CI server" },
]

export function PageContent() {
  return (
    <AdminPageShell title="Rate Limit Configuration" description="Configure global and per-key rate limits" icon={Gauge}>
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
          <h3 className="text-sm font-semibold text-[var(--foreground)]">IP Whitelist</h3>
          <button className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--primary)]/10 px-3 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors cursor-pointer">
            Add IP
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Pattern</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Description</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Action</th>
            </tr>
          </thead>
          <tbody>
            {ipWhitelist.map((ip) => (
              <tr key={ip.pattern} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-2.5 font-mono text-xs text-[var(--foreground)]">{ip.pattern}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{ip.description}</td>
                <td className="px-3 py-2.5 text-right">
                  <button className="text-xs text-rose-400 hover:underline cursor-pointer">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>

      <div className="flex justify-end">
        <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--primary)] px-6 text-sm font-medium text-white hover:opacity-90 transition-opacity cursor-pointer">
          Save Changes
        </button>
      </div>
    </AdminPageShell>
  )
}
