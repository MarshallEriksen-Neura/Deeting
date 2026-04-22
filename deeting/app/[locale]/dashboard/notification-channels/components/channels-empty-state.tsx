"use client"

import { useTranslations } from "next-intl"
import { Bell, Plus, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"

export function ChannelsEmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations("monitoring")
  const chips = [
    t("notificationChannels.empty.chips.structuredConfig"),
    t("notificationChannels.empty.chips.wechatPairing"),
    t("notificationChannels.empty.chips.runtimeVisible"),
  ]

  return (
    <Card className="overflow-hidden border-dashed border-[color:var(--hairline-strong)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--panel-bg)_88%,white_12%)_0%,color-mix(in_srgb,var(--ok-soft)_48%,var(--panel-bg)_52%)_100%)] shadow-[var(--elev-floating)]">
      <CardHeader className="items-center text-center">
        <div className="flex size-16 items-center justify-center rounded-[24px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/84 text-[color:var(--ok)] shadow-[var(--ios-button-shadow-soft)]">
          <Bell className="size-8" />
        </div>
        <CardTitle className="text-2xl tracking-[-0.04em] text-[color:var(--ink)]">
          {t("notificationChannels.empty.title")}
        </CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-7 text-[color:var(--ink-3)]">
          {t("notificationChannels.empty.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 pb-8">
        <div className="flex flex-wrap justify-center gap-2">
          {chips.map((item) => (
            <div
              key={item}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 px-3 py-1.5 text-xs text-[color:var(--ink-2)]"
            >
              <ShieldCheck className="size-3.5 text-[color:var(--accent-strong)]" />
              {item}
            </div>
          ))}
        </div>

        <Button variant="ios-primary" onClick={onAdd}>
          <Plus className="size-4" />
          {t("notificationChannels.empty.addFirst")}
        </Button>
      </CardContent>
    </Card>
  )
}
