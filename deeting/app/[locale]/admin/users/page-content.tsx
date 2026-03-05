"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Users, X } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import {
  fetchAdminUserById,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserItem,
  type UserWithRoles,
} from "@/lib/api/admin-dashboard"

import { UserCreateForm } from "./components/user-create-form"
import { UserFilterBar } from "./components/user-filter-bar"
import { UserStats } from "./components/user-stats"

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

function UserDetailDrawer({
  userId,
  detail,
  detailLoading,
  detailError,
  locale,
  onClose,
}: {
  userId: string | null
  detail: UserWithRoles | null
  detailLoading: boolean
  detailError: Error | null
  locale: string
  onClose: () => void
}) {
  const t = useTranslations("admin.usersPage")

  if (!userId) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[var(--surface,#0a0a0f)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("drawer.title")}</h2>
          <button
            onClick={onClose}
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {detailLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.loading")}</p>}
          {detailError && <p className="text-xs text-rose-400">{t("drawer.failed")}</p>}
          {!detailLoading && !detailError && detail && (
            <>
              <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                <div className="text-[var(--muted)]">{t("drawer.fields.userId")}</div>
                <div className="font-mono text-[var(--foreground)]">{detail.id}</div>
              </div>
              <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                <div className="text-[var(--muted)]">{t("drawer.fields.email")}</div>
                <div className="text-[var(--foreground)]">{detail.email}</div>
              </div>
              <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                <div className="text-[var(--muted)]">{t("drawer.fields.username")}</div>
                <div className="text-[var(--foreground)]">{detail.username ?? "—"}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[var(--muted)]">{t("drawer.fields.status")}</div>
                  <div className="text-[var(--foreground)]">
                    {detail.is_active ? t("status.active") : t("status.inactive")}
                  </div>
                </div>
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[var(--muted)]">{t("drawer.fields.superuser")}</div>
                  <div className="text-[var(--foreground)]">
                    {detail.is_superuser ? t("status.superuser") : "—"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[var(--muted)]">{t("drawer.fields.created")}</div>
                  <div className="text-[var(--foreground)]">{formatDate(detail.created_at, locale)}</div>
                </div>
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-[var(--muted)]">{t("drawer.fields.updated")}</div>
                  <div className="text-[var(--foreground)]">{formatDate(detail.updated_at, locale)}</div>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs text-[var(--muted)]">{t("drawer.fields.roles")}</div>
                {detail.roles.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">{t("drawer.rolesEmpty")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.roles.map((role) => (
                      <span
                        key={role.id}
                        className="inline-flex items-center rounded-full border border-white/10 px-2 py-1 text-[10px] text-[var(--foreground)]"
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.usersPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [superuserFilter, setSuperuserFilter] = useState("")
  const [actioningUserId, setActioningUserId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // 使用 SWR 进行客户端数据获取
  // 未来可以改为服务端获取后通过 props 传递
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/users?limit=100", () => fetchAdminUsers({ limit: 100 }))
  const {
    data: selectedUserDetail,
    error: selectedUserDetailError,
    isLoading: selectedUserDetailLoading,
    mutate: mutateSelectedUserDetail,
  } = useSWR(
    selectedUserId ? ["/api/v1/admin/users/detail", selectedUserId] : null,
    () => fetchAdminUserById(selectedUserId!)
  )

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
    if (actioningUserId) return
    setActioningUserId(row.id)
    setActionFeedback(null)
    try {
      await updateAdminUser(row.id, { is_active: !row.is_active })
      setActionFeedback(t("feedback.statusUpdated", { email: row.email }))
      await Promise.all([
        mutate(),
        selectedUserId === row.id ? mutateSelectedUserDetail() : Promise.resolve(undefined),
      ])
    } catch (updateError) {
      const message =
        updateError instanceof Error ? updateError.message : t("feedback.updateFailed")
      setActionFeedback(message)
    } finally {
      setActioningUserId(null)
    }
  }

  const handleToggleSuperuser = async (row: AdminUserItem) => {
    if (actioningUserId) return
    setActioningUserId(row.id)
    setActionFeedback(null)
    try {
      await updateAdminUser(row.id, { is_superuser: !row.is_superuser })
      setActionFeedback(t("feedback.superuserUpdated", { email: row.email }))
      await Promise.all([
        mutate(),
        selectedUserId === row.id ? mutateSelectedUserDetail() : Promise.resolve(undefined),
      ])
    } catch (updateError) {
      const message =
        updateError instanceof Error ? updateError.message : t("feedback.updateFailed")
      setActionFeedback(message)
    } finally {
      setActioningUserId(null)
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
        onSuccess={(user) => {
          setActionFeedback(t("feedback.created", { email: user.email }))
          void mutate()
        }}
        onError={(message) => {
          setActionFeedback(message)
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
      {actionFeedback && <p className="text-xs text-[var(--muted)]">{actionFeedback}</p>}

      {/* 数据表格 */}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => {
          setSelectedUserId(row.id)
        }}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
        rowActions={(row) => (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleActive(row)
              }}
              disabled={isLoading || actioningUserId === row.id}
              className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {row.is_active ? t("actions.deactivate") : t("actions.activate")}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleSuperuser(row)
              }}
              disabled={isLoading || actioningUserId === row.id}
              className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-amber-400/20 px-2 text-xs text-amber-300 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {row.is_superuser ? t("actions.demoteSuperuser") : t("actions.promoteSuperuser")}
            </button>
          </div>
        )}
      />
      <UserDetailDrawer
        userId={selectedUserId}
        detail={selectedUserDetail ?? null}
        detailLoading={selectedUserDetailLoading}
        detailError={selectedUserDetailError instanceof Error ? selectedUserDetailError : null}
        locale={locale}
        onClose={() => setSelectedUserId(null)}
      />
    </AdminPageShell>
  )
}
