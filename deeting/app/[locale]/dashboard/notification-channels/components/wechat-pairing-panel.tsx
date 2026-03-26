"use client"

import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"

export function WechatPairingPanel({
  pendingPairings,
  allowlistSize,
  pairingCode,
  onPairingCodeChange,
  onApprove,
  onReject,
  busy = false,
  feedback,
}: {
  pendingPairings: number
  allowlistSize: number
  pairingCode: string
  onPairingCodeChange: (value: string) => void
  onApprove: () => void
  onReject: () => void
  busy?: boolean
  feedback?: string | null
}) {
  const t = useTranslations("dashboard.notificationChannelsPage.wechatPairing")

  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
          {t("pendingPairings", { count: pendingPairings })}
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
          {t("allowlistSize", { count: allowlistSize })}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          value={pairingCode}
          onChange={(event) => onPairingCodeChange(event.target.value)}
          placeholder={t("codePlaceholder")}
          className="h-10 w-full rounded-xl border-white/10 bg-[var(--foreground)]/[0.03] text-[var(--foreground)] placeholder:text-[var(--muted)]/40"
        />
        <GlassButton
          type="button"
          size="sm"
          onClick={onApprove}
          disabled={busy || pairingCode.trim().length === 0}
        >
          {t("approve")}
        </GlassButton>
        <GlassButton
          type="button"
          size="sm"
          variant="secondary"
          onClick={onReject}
          disabled={busy || pairingCode.trim().length === 0}
        >
          {t("reject")}
        </GlassButton>
      </div>

      {feedback ? (
        <div className="mt-2 text-xs text-[var(--muted)]">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
