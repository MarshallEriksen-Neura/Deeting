"use client"

import { useTranslations } from "next-intl"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

/**
 * Admin Dashboard 页面加载骨架
 * 用于 Suspense fallback
 */
export function AdminPageSkeleton() {
  const t = useTranslations("admin")

  return (
    <AdminPageShell
      title={t("common.loading")}
      description={t("dashboard.loadingDescription")}
    >
      {/* 统计卡片骨架 */}
      <AdminSkeleton variant="stats" columns={4} />

      {/* 主体内容区域骨架 */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Provider Health 骨架 */}
        <AdminSkeleton variant="card" className="lg:col-span-2" />

        {/* Pending Actions 骨架 */}
        <AdminSkeleton variant="card" />
      </div>

      {/* Recent Errors 骨架 */}
      <AdminSkeleton variant="table" rows={5} />
    </AdminPageShell>
  )
}

export default AdminPageSkeleton
