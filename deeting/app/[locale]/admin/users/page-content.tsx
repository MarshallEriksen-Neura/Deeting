"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Users } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import { fetchAdminUsers, type AdminUserItem } from "@/lib/api/admin-dashboard"

import { UserCreateForm } from "./components/user-create-form"
import { UserFilterBar } from "./components/user-filter-bar"
import { UserStats } from "./components/user-stats"

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.usersPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [superuserFilter, setSuperuserFilter] = useState("")

  // 使用 SWR 进行客户端数据获取
  // 未来可以改为服务端获取后通过 props 传递
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/users?limit=100", () => fetchAdminUsers({ limit: 100 }))

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  // 过滤逻辑
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter === "active" && !row.is_active) return false
      if (statusFilter === "inactive" && row.is_active) return false
      if (superuserFilter === "true" && !row.is_superuser) return false
      if (superuserFilter === "false" && row.is_superuser) return false
      if (!query) return true
      return [row.username, row.email, row.id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, statusFilter, superuserFilter])

  // 表格列定义
  const columns: ColumnDef<AdminUserItem>[] = [
    {
      key: "username",
      header: t("table.headers.username"),
      sortable: true,
      render: (row) => (
        <span className="font-medium text-[var(--foreground)]">{row.username || "—"}</span>
      ),
    },
    { key: "email", header: t("table.headers.email"), sortable: true },
    {
      key: "is_active",
      header: t("table.headers.status"),
      render: (row) => {
        const status = row.is_active ? "active" : "inactive"
        const statusText = row.is_active ? t("status.active") : t("status.inactive")
        return <AdminStatusBadge text={statusText} tone={getStatusTone(status)} />
      },
    },
    {
      key: "is_superuser",
      header: t("table.headers.superuser"),
      render: (row) =>
        row.is_superuser ? (
          <AdminStatusBadge text={t("status.superuser")} tone="amber" dot={false} />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: t("table.headers.registered"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {formatDate(row.created_at, locale)}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: t("table.headers.updated"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {formatDate(row.updated_at, locale)}
        </span>
      ),
    },
  ]

  // 处理用户状态切换
  const handleToggleActive = async (row: AdminUserItem) => {
    try {
      await fetch(`/api/v1/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !row.is_active }),
      })
      // 刷新数据
      await mutate()
    } catch (error) {
      console.error("Failed to toggle user status:", error)
    }
  }

  return (
    <AdminPageShell
      title={tAdmin("users.title")}
      description={tAdmin("users.description")}
      icon={Users}
    >
      {/* 统计卡片 */}
      <UserStats users={allRows} />

      {/* 创建表单 */}
      <UserCreateForm
        onSuccess={() => {
          // 刷新数据
          mutate()
        }}
      />

      {/* 过滤栏 */}
      <UserFilterBar
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "superuser") setSuperuserFilter(value)
        }}
      />

      {/* 数据表格 */}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
        rowActions={(row) => (
          <button
            onClick={(event) => {
              event.stopPropagation()
              void handleToggleActive(row)
            }}
            disabled={isLoading}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {row.is_active ? t("actions.deactivate") : t("actions.activate")}
          </button>
        )}
      />
    </AdminPageShell>
  )
}
