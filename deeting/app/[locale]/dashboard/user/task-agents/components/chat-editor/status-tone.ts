export function statusToneClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"
    case "starting":
    case "pending":
    case "updating":
      return "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
    case "degraded":
      return "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)] opacity-80"
    case "error":
    case "crashed":
    case "orphaned":
      return "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
    default:
      return "border-[var(--hairline)] bg-[var(--panel-bg-inset)]/60 text-[var(--ink-3)]"
  }
}
