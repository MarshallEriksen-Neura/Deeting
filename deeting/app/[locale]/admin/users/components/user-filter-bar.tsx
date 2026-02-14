"use client"

import { useTranslations } from "next-intl"
import { AdminFilterBar } from "@/components/admin"

interface UserFilterBarProps {
  /**
   * 搜索值变化回调
   */
  onSearch?: (query: string) => void
  /**
   * 过滤条件变化回调
   */
  onFilterChange?: (key: string, value: string) => void
  /**
   * 初始搜索值
   */
  initialSearch?: string
  /**
   * 初始过滤值
   */
  initialFilters?: {
    status?: string
    superuser?: string
  }
}

export function UserFilterBar({
  onSearch,
  onFilterChange,
}: UserFilterBarProps) {
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
