"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { AdminPageShell, AdminPanel } from "@/components/admin/admin-shell"
import { PresetEditorConsole } from "../components/preset-editor-console"

export function PageContent() {
  const searchParams = useSearchParams()
  const t = useTranslations("admin.providerPresetsEditor")
  const slug = searchParams.get("slug")?.trim() ?? ""

  if (!slug) {
    return (
      <AdminPageShell
        eyebrow={t("title")}
        title={t("title")}
        description={t("feedback.loadFailed")}
      >
        <AdminPanel className="p-6 text-sm text-rose-500">{t("feedback.loadFailed")}</AdminPanel>
      </AdminPageShell>
    )
  }

  return <PresetEditorConsole mode="edit" slug={slug} />
}
