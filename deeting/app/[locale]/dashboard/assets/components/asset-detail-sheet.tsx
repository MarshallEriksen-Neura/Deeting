"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { LocalAsset } from "@/lib/api/local-assets"

interface AssetDetailSheetProps {
  asset: LocalAsset | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssetDetailSheet({
  asset,
  open,
  onOpenChange,
}: AssetDetailSheetProps) {
  const t = useTranslations("dashboard.assetsPage")

  if (!asset) return null

  const renderData = safeParseJson(asset.latest_render_data_json)
  const refreshSpec = safeParseJson(asset.refresh_spec_json)
  const outputExample = safeParseJson(asset.output_example_json)
  const matchHints = safeParseJson(asset.match_hints_json)
  const propsHint = safeParseJson(asset.props_hint_json)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="h-full max-h-screen w-full max-w-[720px] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border/60 bg-background/90 px-6 py-5 text-left">
          <div className="space-y-3 pr-10">
            <div className="space-y-2">
              <SheetTitle className="line-clamp-2 text-xl leading-tight text-foreground">
                {asset.title}
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {asset.summary || t("empty.summary")}
              </SheetDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="uppercase tracking-[0.14em] text-[10px]">
                {asset.render_hint || asset.source_view_type}
              </Badge>
              {asset.data_mode ? (
                <Badge variant="outline" className="text-[10px]">
                  {asset.data_mode}
                </Badge>
              ) : null}
              {asset.template_id ? (
                <Badge variant="outline" className="text-[10px]">
                  {asset.template_id}
                </Badge>
              ) : null}
              {asset.template_version ? (
                <Badge variant="outline" className="text-[10px]">
                  {asset.template_version}
                </Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t("fields.updatedAt", { value: asset.updated_at })}</span>
              <span>·</span>
              <span>{t("fields.sourceSession", { value: asset.origin_session_id })}</span>
            </div>

            <Button asChild type="button" variant="outline" size="sm" className="w-fit">
              <Link href={`/chat?session=${encodeURIComponent(asset.origin_session_id)}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("actions.openConversation")}
              </Link>
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto bg-muted/20 p-6">
          {asset.latest_snapshot_html ? (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
                <iframe
                  title={asset.title}
                  srcDoc={asset.latest_snapshot_html}
                  sandbox=""
                  className="h-[520px] w-full bg-white"
                  loading="lazy"
                />
              </div>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-foreground">
                    {t("sections.renderData")}
                  </div>
                  <pre className="overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">
                    {renderData
                      ? JSON.stringify(renderData, null, 2)
                      : t("empty.renderData")}
                  </pre>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-foreground">
                    {t("sections.refreshSpec")}
                  </div>
                  <pre className="overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">
                    {refreshSpec
                      ? JSON.stringify(refreshSpec, null, 2)
                      : t("empty.refreshSpec")}
                  </pre>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-foreground">
                    {t("sections.outputExample")}
                  </div>
                  <pre className="overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">
                    {outputExample
                      ? JSON.stringify(outputExample, null, 2)
                      : t("empty.outputExample")}
                  </pre>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-foreground">
                    {t("sections.assetContract")}
                  </div>
                  <div className="space-y-3 text-xs text-foreground">
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {t("fields.dataModeLabel")}
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        {asset.data_mode || t("empty.dataMode")}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {t("fields.htmlEntry")}
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2 break-all">
                        {asset.html_entry || t("empty.htmlEntry")}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {t("sections.matchHints")}
                      </div>
                      <pre className="overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">
                        {matchHints
                          ? JSON.stringify(matchHints, null, 2)
                          : t("empty.matchHints")}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {t("sections.propsHint")}
                      </div>
                      <pre className="overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-foreground">
                        {propsHint
                          ? JSON.stringify(propsHint, null, 2)
                          : t("empty.propsHint")}
                      </pre>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              {t("empty.snapshot")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function safeParseJson(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
