"use client"

import { useTranslations } from "next-intl"
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
  const t = useTranslations("monitoring")

  return (
    <Card className="border-dashed bg-[color:var(--ios-shell-subtle)]/70">
      <CardHeader className="items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] text-[color:var(--ios-tint)]">
          <Crosshair className="size-7" />
        </div>
        <CardTitle>{t("monitors.empty.title")}</CardTitle>
        <CardDescription className="max-w-xl">
          {t("monitors.empty.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button onClick={onCreate} variant="ios-primary">
          <Plus className="size-4" />
          {t("monitors.empty.create")}
        </Button>
      </CardContent>
    </Card>
  )
}
