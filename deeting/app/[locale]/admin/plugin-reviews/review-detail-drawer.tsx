"use client"

import { useTranslations } from "next-intl"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PluginMarketReviewItem } from "@/lib/api/admin-dashboard"

interface ReviewDetailDrawerProps {
  locale: string
  review: PluginMarketReviewItem | null
  onClose: () => void
}

function formatJson(value: unknown) {
  if (!value || (typeof value === "object" && !Object.keys(value as Record<string, unknown>).length)) {
    return "—"
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return "—"
  }
}

function formatDateTime(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function renderItems(items: Array<string | null | undefined>) {
  const values = items.map((item) => item?.trim()).filter(Boolean) as string[]
  if (!values.length) return <p className="text-sm text-[var(--muted)]">—</p>
  return <ul className="space-y-2">{values.map((item) => <li key={item} className="rounded-md border border-white/10 px-3 py-2 text-sm">{item}</li>)}</ul>
}

export function ReviewDetailDrawer({ locale, review, onClose }: ReviewDetailDrawerProps) {
  const t = useTranslations("admin.pluginReviewsPage")
  const findings = review?.findings ?? []
  const manifestText = formatJson(review?.manifest_json)

  return (
    <Sheet open={Boolean(review)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{review?.name ?? t("drawer.fallbackTitle")}</SheetTitle>
          <SheetDescription>{review?.id ?? "—"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <section className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-2">
            <div><p className="text-[var(--muted)]">{t("drawer.meta.status")}</p><p>{review?.status ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.risk")}</p><p>{review?.risk_level ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.runtime")}</p><p>{review?.runtime ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.version")}</p><p>{review?.version ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.submitter")}</p><p className="break-all">{review?.submitter_user_id ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.reviewer")}</p><p className="break-all">{review?.reviewer_user_id ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.reviewedAt")}</p><p>{formatDateTime(review?.reviewed_at, locale)}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.repo")}</p><p className="break-all">{review?.source_repo ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.revision")}</p><p>{review?.source_revision ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.meta.subdir")}</p><p>{review?.source_subdir ?? "—"}</p></div>
          </section>

          <section className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-2">
            <div><p className="text-[var(--muted)]">{t("drawer.trace.securityDecision")}</p><p>{review?.security_review_decision ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.trace.submissionChannel")}</p><p>{review?.submission_channel ?? "—"}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.trace.requiresApproval")}</p><p>{review?.requires_admin_approval ? t("drawer.trace.required") : t("drawer.trace.notRequired")}</p></div>
            <div><p className="text-[var(--muted)]">{t("drawer.trace.reviewReason")}</p><p>{review?.review_reason ?? "—"}</p></div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.summary")}</h3>
            <p className="rounded-md border border-white/10 px-3 py-2 text-sm text-[var(--muted)]">
              {review?.security_review_summary ?? review?.description ?? "—"}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.findings")}</h3>
            {findings.length ? (
              <ul className="space-y-2">
                {findings.map((finding, index) => (
                  <li key={`${finding.category ?? "finding"}-${index}`} className="rounded-md border border-white/10 px-3 py-2 text-sm">
                    <p className="font-medium">{finding.category ?? t("drawer.findings.uncategorized")}</p>
                    <p className="text-xs text-[var(--muted)]">{finding.severity ?? "—"} · {finding.file ?? "—"}</p>
                    <p className="text-[var(--muted)]">{finding.message ?? "—"}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">—</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.networkTargets")}</h3>
            {renderItems(review?.network_targets ?? [])}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.privacyRisks")}</h3>
            {renderItems(review?.privacy_risks ?? [])}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.destructiveActions")}</h3>
            {renderItems(review?.destructive_actions ?? [])}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.reviewReason")}</h3>
            <p className="rounded-md border border-white/10 px-3 py-2 text-sm text-[var(--muted)]">
              {review?.review_reason ?? "—"}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("drawer.sections.manifest")}</h3>
            <pre className="overflow-x-auto rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-[var(--muted)] whitespace-pre-wrap break-all">
              {manifestText}
            </pre>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

