"use client"

import { useTranslations } from "next-intl"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

/**
 * Users 页面加载骨架
 * 用于 Suspense fallback
 */
export function UsersPageSkeleton() {
  const t = useTranslations("admin")

  return (
    <AdminPageShell
      title={t("common.loading")}
      description={t("usersPage.loadingDescription")}
    >
      {/* 统计卡片骨架 */}
      <AdminSkeleton variant="stats" columns={4} />

      {/* 创建表单骨架 */}
      <AdminSkeleton variant="form" />

      {/* 表格骨架 */}
      <AdminSkeleton variant="table" rows={8} />
    </AdminPageShell>
  )
}

export default UsersPageSkeleton
