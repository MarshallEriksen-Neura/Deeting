"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Shield, UserPlus, Users, X } from "lucide-react"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatCards,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import {
  fetchAdminUserById,
  fetchAdminUsers,
  updateAdminUser,
  createAdminUser,
  type AdminUserItem,
  type UserWithRoles,
} from "@/lib/api/admin-dashboard"

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
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
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("drawer.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("drawer.subtitle")}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {detailLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.loading")}</p>}
          {detailError && <p className="text-xs text-rose-400">{t("drawer.failed")}</p>}
          {!detailLoading && !detailError && detail && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                  <div className="text-[var(--muted)]">{t("drawer.fields.status")}</div>
                  <div className="text-[var(--foreground)]">
                    {detail.is_active ? t("status.active") : t("status.inactive")}
                  </div>
                </div>
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                  <div className="text-[var(--muted)]">{t("drawer.fields.superuser")}</div>
                  <div className="text-[var(--foreground)]">
                    {detail.is_superuser ? t("status.superuser") : "—"}
                  </div>
                </div>
              </div>
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

function CreateUserStrip({
  onCreated,
  onError,
}: {
  onCreated: (email: string) => void
  onError: (message: string) => void
}) {
  const t = useTranslations("admin.usersPage.createForm")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit() {
    if (!email.trim() || !password.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await createAdminUser({
        email: email.trim(),
        password,
        username: username.trim() || undefined,
      })
      setEmail("")
      setUsername("")
      setPassword("")
      onCreated(result.email)
    } catch (submitError) {
      onError(submitError instanceof Error ? submitError.message : t("feedback.createFailed"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <GlassCard padding="default" hover="none" className="overflow-hidden">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--primary)]">
            <UserPlus className="size-3.5" />
            {t("label")}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">{t("title")}</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("subtitle")}</p>
          </div>
        </div>
        <div className="grid w-full gap-3 lg:max-w-4xl lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("placeholders.email")}
          />
          <Input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("placeholders.usernameOptional")}
          />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("placeholders.temporaryPassword")}
          />
          <Button
            onClick={() => void handleSubmit()}
            disabled={!email.trim() || !password.trim() || isSubmitting}
            className="min-w-32"
          >
            {isSubmitting ? t("actions.submitting") : t("actions.createUser")}
          </Button>
        </div>
      </div>
    </GlassCard>
  )
}

export function PageContent() {
  const t = useTranslations("admin.usersPage")
  const common = useTranslations("admin.common")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [superuserFilter, setSuperuserFilter] = useState("")
  const [actioningUserId, setActioningUserId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    "/api/v1/admin/users?limit=100",
    () => fetchAdminUsers({ limit: 100 })
  )
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

  const stats = useMemo(() => {
    const totalUsers = allRows.length
    const activeUsers = allRows.filter((user) => user.is_active).length
    const inactiveUsers = totalUsers - activeUsers
    const superUsers = allRows.filter((user) => user.is_superuser).length
    return [
      { label: t("stats.totalUsers"), value: totalUsers, icon: Users, color: "primary" as const },
      { label: t("stats.active"), value: activeUsers, icon: Shield, color: "emerald" as const },
      { label: t("stats.inactive"), value: inactiveUsers, icon: Users, color: "rose" as const },
      { label: t("stats.superusers"), value: superUsers, icon: Shield, color: "amber" as const },
    ]
  }, [allRows, t])

  const columns: ColumnDef<AdminUserItem>[] = [
    {
      key: "identity",
      header: t("table.headers.username"),
      sortable: true,
      render: (row) => (
        <div className="space-y-1">
          <div className="font-semibold text-[var(--foreground)]">{row.username || "—"}</div>
          <div className="font-mono text-xs text-[var(--muted)]">{row.id}</div>
        </div>
      ),
    },
    {
      key: "email",
      header: t("table.headers.email"),
      sortable: true,
      render: (row) => <span className="text-sm text-[var(--foreground)]">{row.email}</span>,
    },
    {
      key: "is_active",
      header: t("table.headers.status"),
      render: (row) => {
        const status = row.is_active ? "active" : "inactive"
        return <AdminStatusBadge text={t(`status.${status}`)} tone={getStatusTone(status)} />
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
        <span className="text-xs text-[var(--muted)]">{formatDate(row.created_at, locale)}</span>
      ),
    },
    {
      key: "updated_at",
      header: t("table.headers.updated"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{formatDate(row.updated_at, locale)}</span>
      ),
    },
  ]

  const handleToggleActive = async (row: AdminUserItem) => {
    if (actioningUserId) return
    setActioningUserId(row.id)
    setActionFeedback(null)
    try {
      await updateAdminUser(row.id, { is_active: !row.is_active })
      setFeedbackTone("success")
      setActionFeedback(t("feedback.statusUpdated", { email: row.email }))
      await Promise.all([
        mutate(),
        selectedUserId === row.id ? mutateSelectedUserDetail() : Promise.resolve(undefined),
      ])
    } catch (updateError) {
      setFeedbackTone("error")
      setActionFeedback(
        updateError instanceof Error ? updateError.message : t("feedback.updateFailed")
      )
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
      setFeedbackTone("success")
      setActionFeedback(t("feedback.superuserUpdated", { email: row.email }))
      await Promise.all([
        mutate(),
        selectedUserId === row.id ? mutateSelectedUserDetail() : Promise.resolve(undefined),
      ])
    } catch (updateError) {
      setFeedbackTone("error")
      setActionFeedback(
        updateError instanceof Error ? updateError.message : t("feedback.updateFailed")
      )
    } finally {
      setActioningUserId(null)
    }
  }

  return (
    <div className="space-y-5">
      <GlassCard padding="default" hover="none" className="overflow-hidden">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--primary)]">
              <Shield className="size-3.5" />
              {t("consoleLabel")}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {t("consoleTitle")}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
                {t("consoleDescription")}
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      <AdminStatCards stats={stats} columns={4} />

      <CreateUserStrip
        onCreated={(email) => {
          setFeedbackTone("success")
          setActionFeedback(t("feedback.created", { email }))
          void mutate()
        }}
        onError={(message) => {
          setFeedbackTone("error")
          setActionFeedback(message)
        }}
      />

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "superuser") setSuperuserFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status.label"),
            options: [
              { label: t("filters.status.active"), value: "active" },
              { label: t("filters.status.inactive"), value: "inactive" },
            ],
          },
          {
            key: "superuser",
            label: t("filters.superuser.label"),
            options: [
              { label: t("filters.superuser.yes"), value: "true" },
              { label: t("filters.superuser.no"), value: "false" },
            ],
          },
        ]}
      />

      {actionFeedback ? (
        <GlassCard padding="default" hover="none">
          <p
            className={
              feedbackTone === "error"
                ? "text-sm text-rose-300"
                : "text-sm text-emerald-300"
            }
          >
            {actionFeedback}
          </p>
        </GlassCard>
      ) : null}

      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => {
          setSelectedUserId(row.id)
        }}
        emptyMessage={
          isLoading ? t("empty.loading") : error ? t("empty.failed") : t("empty.noData")
        }
        rowActions={(row) => (
          <div className="inline-flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleActive(row)
              }}
              disabled={isLoading || actioningUserId === row.id}
            >
              {row.is_active ? t("actions.deactivate") : t("actions.activate")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleSuperuser(row)
              }}
              disabled={isLoading || actioningUserId === row.id}
              className="border-amber-400/20 text-amber-300 hover:bg-amber-500/10"
            >
              {row.is_superuser
                ? t("actions.demoteSuperuser")
                : t("actions.promoteSuperuser")}
            </Button>
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
    </div>
  )
}
