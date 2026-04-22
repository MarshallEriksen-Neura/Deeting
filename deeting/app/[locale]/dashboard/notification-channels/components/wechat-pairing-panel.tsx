"use client"

import { useTranslations } from "next-intl"

import { Input } from "@/components/ui/shadcn/input"
import { Button } from "@/components/ui/shadcn/button"

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
  const t = useTranslations("monitoring")

  return (
    <div className="rounded-[22px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/80 p-4 shadow-[var(--ios-button-shadow-soft)]">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-3)]">
        <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-2.5 py-1">
          {t("notificationChannels.wechat.pairing.pendingPairings", { count: pendingPairings })}
        </span>
        <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-2.5 py-1">
          {t("notificationChannels.wechat.pairing.allowlistSize", { count: allowlistSize })}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          value={pairingCode}
          onChange={(event) => onPairingCodeChange(event.target.value)}
          placeholder={t("notificationChannels.wechat.pairing.inputPlaceholder")}
          className="h-10 w-full rounded-xl"
        />
        <Button type="button" size="sm" onClick={onApprove} disabled={busy || pairingCode.trim().length === 0}>
          {t("notificationChannels.wechat.pairing.approve")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy || pairingCode.trim().length === 0}>
          {t("notificationChannels.wechat.pairing.reject")}
        </Button>
      </div>

      {feedback ? (
        <div className="mt-2 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 px-3 py-2 text-xs text-[color:var(--ink-3)]">
          {feedback}
        </div>
      ) : null}

      {contextContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-[color:var(--ink-3)]">{t("notificationChannels.wechat.pairing.contextContactsTitle")}</div>
          <div className="flex flex-wrap gap-2">
            {contextContacts.map((contactId) => (
              <div
                key={`ctx-${contactId}`}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--ok-border)] bg-[color:var(--ok-soft)] px-2 py-1 text-[11px] text-[color:var(--ok)]"
              >
                <button type="button" onClick={() => onUseContact(contactId)} className="rounded-full px-1">
                  {t("notificationChannels.wechat.pairing.contactWithContext", { contactId })}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyContact(contactId)}
                  className="rounded-full border border-[color:var(--ok-border)] px-1.5 py-0.5 text-[10px]"
                  aria-label={t("notificationChannels.wechat.pairing.copyAria", { contactId })}
                >
                  {t("notificationChannels.wechat.pairing.copy")}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {allowlistContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-[color:var(--ink-3)]">{t("notificationChannels.wechat.pairing.approvedContactsTitle")}</div>
          <div className="flex flex-wrap gap-2">
            {allowlistContacts.map((contactId) => (
              <div
                key={`allow-${contactId}`}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-2 py-1 text-[11px] text-[color:var(--ink-2)]"
              >
                <button type="button" onClick={() => onUseContact(contactId)} className="rounded-full px-1">
                  {t("notificationChannels.wechat.pairing.contactApproved", { contactId })}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyContact(contactId)}
                  className="rounded-full border border-[color:var(--hairline)] px-1.5 py-0.5 text-[10px]"
                  aria-label={t("notificationChannels.wechat.pairing.copyAria", { contactId })}
                >
                  {t("notificationChannels.wechat.pairing.copy")}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
