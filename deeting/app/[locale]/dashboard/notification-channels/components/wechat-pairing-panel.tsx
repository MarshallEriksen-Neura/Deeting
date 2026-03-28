"use client"

import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"

export function WechatPairingPanel({
  pendingPairings,
  allowlistSize,
  allowlistContacts,
  contextContacts,
  pairingCode,
  onPairingCodeChange,
  onUseContact,
  onCopyContact,
  onApprove,
  onReject,
  busy = false,
  feedback,
}: {
  pendingPairings: number
  allowlistSize: number
  allowlistContacts: string[]
  contextContacts: string[]
  pairingCode: string
  onPairingCodeChange: (value: string) => void
  onUseContact: (contactId: string) => void
  onCopyContact: (contactId: string) => void
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

      {contextContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-[var(--muted)]">
            {t("contextContacts")}
          </div>
          <div className="flex flex-wrap gap-2">
            {contextContacts.map((contactId) => (
              <div
                key={`ctx-${contactId}`}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300"
              >
                <button
                  type="button"
                  onClick={() => onUseContact(contactId)}
                  className="rounded-full px-1"
                >
                  {contactId} · {t("hasContext")}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyContact(contactId)}
                  className="rounded-full border border-emerald-500/20 px-1.5 py-0.5 text-[10px]"
                  aria-label={`${t("copy")} ${contactId}`}
                >
                  {t("copy")}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {allowlistContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-[var(--muted)]">
            {t("approvedContacts")}
          </div>
          <div className="flex flex-wrap gap-2">
            {allowlistContacts.map((contactId) => (
              <div
                key={`allow-${contactId}`}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[var(--foreground)]"
              >
                <button
                  type="button"
                  onClick={() => onUseContact(contactId)}
                  className="rounded-full px-1"
                >
                  {contactId} · {t("approved")}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyContact(contactId)}
                  className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px]"
                  aria-label={`${t("copy")} ${contactId}`}
                >
                  {t("copy")}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
