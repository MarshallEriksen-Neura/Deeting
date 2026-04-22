"use client"

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
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-background px-2.5 py-1">待处理配对 {pendingPairings}</span>
        <span className="rounded-full bg-background px-2.5 py-1">白名单联系人 {allowlistSize}</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          value={pairingCode}
          onChange={(event) => onPairingCodeChange(event.target.value)}
          placeholder="输入 pairing code"
          className="h-10 w-full rounded-xl"
        />
        <Button type="button" size="sm" onClick={onApprove} disabled={busy || pairingCode.trim().length === 0}>
          通过
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy || pairingCode.trim().length === 0}>
          拒绝
        </Button>
      </div>

      {feedback ? <div className="mt-2 text-xs text-muted-foreground">{feedback}</div> : null}

      {contextContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">已有上下文的联系人</div>
          <div className="flex flex-wrap gap-2">
            {contextContacts.map((contactId) => (
              <div key={`ctx-${contactId}`} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700">
                <button type="button" onClick={() => onUseContact(contactId)} className="rounded-full px-1">
                  {contactId} · 有上下文
                </button>
                <button type="button" onClick={() => onCopyContact(contactId)} className="rounded-full border border-emerald-500/20 px-1.5 py-0.5 text-[10px]" aria-label={`复制 ${contactId}`}>
                  复制
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {allowlistContacts.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">已批准联系人</div>
          <div className="flex flex-wrap gap-2">
            {allowlistContacts.map((contactId) => (
              <div key={`allow-${contactId}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[11px]">
                <button type="button" onClick={() => onUseContact(contactId)} className="rounded-full px-1">
                  {contactId} · 已批准
                </button>
                <button type="button" onClick={() => onCopyContact(contactId)} className="rounded-full border border-border px-1.5 py-0.5 text-[10px]" aria-label={`复制 ${contactId}`}>
                  复制
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
