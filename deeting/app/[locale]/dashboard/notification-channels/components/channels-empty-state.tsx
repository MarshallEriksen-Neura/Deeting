"use client"

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
  return (
    <Card className="overflow-hidden border-dashed border-[color:var(--hairline-strong)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--panel-bg)_88%,white_12%)_0%,color-mix(in_srgb,var(--ok-soft)_48%,var(--panel-bg)_52%)_100%)] shadow-[var(--elev-floating)]">
      <CardHeader className="items-center text-center">
        <div className="flex size-16 items-center justify-center rounded-[24px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/84 text-[color:var(--ok)] shadow-[var(--ios-button-shadow-soft)]">
          <Bell className="size-8" />
        </div>
        <CardTitle className="text-2xl tracking-[-0.04em] text-[color:var(--ink)]">
          先把通知出口准备好
        </CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-7 text-[color:var(--ink-3)]">
          主动寻猎和桌面 IM 运行时都依赖这里的渠道。现在支持的主路径是飞书、微信和
          Telegram，先接好出口，后面的自动化和观测才有真实落点。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 pb-8">
        <div className="flex flex-wrap justify-center gap-2">
          {["结构化字段配置", "微信配对审批", "桌面运行态可见"].map((item) => (
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
          新增第一个渠道
        </Button>
      </CardContent>
    </Card>
  )
}
