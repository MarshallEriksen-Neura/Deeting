"use client"

import { useTranslations } from "next-intl"
import { AdminFilterBar } from "@/components/admin"

interface UserFilterBarProps {
  onSearch?: (query: string) => void
  onFilterChange?: (key: string, value: string) => void
}

export function UserFilterBar({ onSearch, onFilterChange }: UserFilterBarProps) {
  const t = useTranslations("admin.usersPage.filters")

  return (
    <AdminFilterBar
      searchPlaceholder={t("searchPlaceholder")}
      onSearch={onSearch}
      onFilterChange={onFilterChange}
      filters={[
        {
          key: "status",
          label: t("status.label"),
          options: [
            { label: t("status.active"), value: "active" },
            { label: t("status.inactive"), value: "inactive" },
          ],
        },
        {
          key: "superuser",
          label: t("superuser.label"),
          options: [
            { label: t("superuser.yes"), value: "true" },
            { label: t("superuser.no"), value: "false" },
          ],
        },
      ]}
    />
  )
}

export default UserFilterBar
