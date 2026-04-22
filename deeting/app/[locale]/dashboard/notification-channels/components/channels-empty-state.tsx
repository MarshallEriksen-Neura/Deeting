"use client"

import { Bell, Plus } from "lucide-react"

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
    <Card className="border-dashed bg-[color:var(--ios-shell-subtle)]/70">
      <CardHeader className="items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] text-[color:var(--ios-tint)]">
          <Bell className="size-7" />
        </div>
        <CardTitle>还没有通知渠道</CardTitle>
        <CardDescription>
          配置一个本地通知渠道后，主动寻猎任务就可以把结果投递到对应 IM 或消息出口。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button variant="ios-primary" onClick={onAdd}>
          <Plus className="size-4" />
          新增渠道
        </Button>
      </CardContent>
    </Card>
  )
}
