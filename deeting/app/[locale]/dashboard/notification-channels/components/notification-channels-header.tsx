"use client"

import { Bell } from "lucide-react"

export function NotificationChannelsHeader() {
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] px-3 py-1 text-xs text-muted-foreground">
        <Bell className="size-3.5" />
        桌面端通知渠道
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">通知渠道</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理主动寻猎任务的本地通知出口。目前优先支持飞书、微信和 Telegram。
        </p>
      </div>
    </div>
  )
}
