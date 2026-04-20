"use client"

import { memo } from "react"
import { ViewCard } from "@/components/views/view-card"
import { useI18n } from "@/hooks/use-i18n"
import type { PageInspectionResult } from "@/lib/browser/page-inspection"
import { Button } from "@/ui/shadcn/button"
import { useChatStore } from "@/store/chat-store"

interface PageInspectionResultPanelProps {
  result: PageInspectionResult
}

const PageInspectionResultPanel = memo(function PageInspectionResultPanel({
  result,
}: PageInspectionResultPanelProps) {
  const t = useI18n("chat")
  const setInput = useChatStore((state) => state.setInput)

  return (
    <ViewCard title={t("inspection.title")} viewType="page.inspection" className="max-w-none">
      <div className="space-y-5">
        <section className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inspection.pageOverview")}
          </div>
          <div className="text-sm font-medium text-foreground">{result.page.title}</div>
          <div className="text-xs text-muted-foreground">{result.page.url}</div>
          {result.page.module ? (
            <div className="text-xs text-muted-foreground">{result.page.module}</div>
          ) : null}
          <div className="pt-1 text-sm text-foreground">{result.summary}</div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inspection.keyMetrics")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.keyMetrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{metric.label}</div>
                <div className="text-sm font-medium text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inspection.findings")}
          </div>
          <div className="space-y-2">
            {result.findings.map((finding, index) => (
              <div key={`${finding.level}-${index}`} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-[11px] uppercase text-muted-foreground">{finding.level}</div>
                <div className="text-sm text-foreground">{finding.text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inspection.records")}
          </div>
          <div className="space-y-2">
            {result.records.map((record, index) => (
              <div key={`${record.title}-${index}`} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-sm font-medium text-foreground">{record.title}</div>
                <div className="text-xs text-muted-foreground">{record.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inspection.nextActions")}
          </div>
          <div className="space-y-2">
            {result.nextActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="w-full rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/30"
                onClick={() => setInput(action.prompt)}
              >
                <div className="text-sm font-medium text-foreground">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.prompt}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </ViewCard>
  )
})

export default PageInspectionResultPanel
