"use client"

import { Crosshair, Plus } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"

interface MonitorEmptyStateProps {
  onCreate: () => void
}

export function MonitorEmptyState({ onCreate }: MonitorEmptyStateProps) {
  return (
    <Card className="border-dashed bg-[color:var(--ios-shell-subtle)]/70">
      <CardHeader className="items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] text-[color:var(--ios-tint)]">
          <Crosshair className="size-7" />
        </div>
        <CardTitle>还没有主动寻猎任务</CardTitle>
        <CardDescription className="max-w-xl">
          创建一个桌面端本地监控任务，绑定现有聊天型任务智能体，持续观察目标变化并沉淀执行记录。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button onClick={onCreate} variant="ios-primary">
          <Plus className="size-4" />
          新建任务
        </Button>
      </CardContent>
    </Card>
  )
}
