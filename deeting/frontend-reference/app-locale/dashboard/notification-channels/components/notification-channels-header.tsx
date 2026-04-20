"use client"

import { Bell } from "lucide-react"
import { useTranslations } from "next-intl"

export function NotificationChannelsHeader() {
  const t = useTranslations("dashboard.notificationChannelsPage")

  return (
    <div className="mb-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold text-[var(--foreground)]">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10">
          <Bell className="h-5 w-5 text-[var(--primary)]" />
        </div>
        {t("title")}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--muted)]">{t("subtitle")}</p>
    </div>
  )
}

