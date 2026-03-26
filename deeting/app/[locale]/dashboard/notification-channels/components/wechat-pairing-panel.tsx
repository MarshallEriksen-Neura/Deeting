"use client"

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
  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
          待处理配对 {pendingPairings}
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
          已授权联系人 {allowlistSize}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={pairingCode}
          onChange={(event) => onPairingCodeChange(event.target.value)}
          placeholder="输入 6 位配对码"
          className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/40 outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
        />
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || pairingCode.trim().length === 0}
          className="rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          批准配对
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy || pairingCode.trim().length === 0}
          className="rounded-xl border border-white/10 px-3.5 py-2 text-xs text-[var(--foreground)] disabled:opacity-50"
        >
          拒绝配对
        </button>
      </div>

      {feedback ? (
        <div className="mt-2 text-xs text-[var(--muted)]">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
