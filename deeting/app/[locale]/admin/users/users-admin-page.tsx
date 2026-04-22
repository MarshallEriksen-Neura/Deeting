"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Shield, UserCheck, UserPlus, Users, X } from "lucide-react"

import {
  createAdminUser,
  fetchAdminUserById,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserItem,
} from "@/lib/api/admin-dashboard"
import { Button } from "@/ui/shadcn/button"
import { Input } from "@/ui/shadcn/input"
import {
  AdminMetricGrid,
  AdminPageShell,
  AdminPanel,
  AdminStatusPill,
} from "@/components/admin/admin-shell"

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function UserDrawer({
  userId,
  locale,
  onClose,
}: {
  userId: string | null
  locale: string
  onClose: () => void
}) {
  const t = useTranslations("admin.usersPage")
  const { data, error, isLoading } = useSWR(
    userId ? ["admin/user", userId] : null,
    ([, id]) => fetchAdminUserById(id)
  )

  if (!userId) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-[var(--hairline)] bg-[var(--panel-bg)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] p-5">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">
              {t("drawer.title")}
            </h2>
            <p className="text-sm text-[var(--ink-3)]">{t("drawer.subtitle")}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isLoading ? (
            <p className="text-sm text-[var(--ink-3)]">{t("drawer.loading")}</p>
          ) : null}
          {error ? (
            <p className="text-sm text-rose-500">{t("drawer.failed")}</p>
          ) : null}
          {data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] p-4">
                  <div className="text-xs text-[var(--ink-3)]">
                    {t("drawer.fields.status")}
                  </div>
                  <div className="mt-2">
                    <AdminStatusPill
                      active={data.is_active}
                      label={
                        data.is_active ? t("status.active") : t("status.inactive")
                      }
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] p-4">
                  <div className="text-xs text-[var(--ink-3)]">
                    {t("drawer.fields.superuser")}
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--ink)]">
                    {data.is_superuser
                      ? t("filters.superuser.yes")
                      : t("filters.superuser.no")}
                  </div>
                </div>
              </div>
              {[
                [t("drawer.fields.userId"), data.id],
                [t("drawer.fields.email"), data.email],
                [t("drawer.fields.username"), data.username ?? "-"],
                [t("drawer.fields.created"), formatDate(data.created_at, locale)],
                [t("drawer.fields.updated"), formatDate(data.updated_at, locale)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] p-4"
                >
                  <div className="text-xs text-[var(--ink-3)]">{label}</div>
                  <div className="mt-2 break-all font-mono text-sm text-[var(--ink)]">
                    {value}
                  </div>
                </div>
              ))}
              <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] p-4">
                <div className="text-xs text-[var(--ink-3)]">
                  {t("drawer.fields.roles")}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.roles.length ? (
                    data.roles.map((role) => (
                      <span
                        key={role.id}
                        className="rounded-full border border-[var(--hairline)] px-2.5 py-1 text-xs text-[var(--ink-2)]"
                      >
                        {role.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[var(--ink-3)]">
                      {t("drawer.rolesEmpty")}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>
  )
}

function CreateUserPanel({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("admin.usersPage.createForm")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!email.trim() || !password.trim() || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      await createAdminUser({
        email: email.trim(),
        username: username.trim() || undefined,
        password,
      })
      setEmail("")
      setUsername("")
      setPassword("")
      onCreated()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("feedback.createFailed"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AdminPanel className="p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-xl space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-3)]">
            <UserPlus className="size-3.5" />
            {t("label")}
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
            {t("title")}
          </h2>
          {error ? (
            <p className="text-sm text-rose-500">{error}</p>
          ) : (
            <p className="text-sm text-[var(--ink-3)]">{t("subtitle")}</p>
          )}
        </div>
        <div className="grid w-full gap-3 xl:max-w-3xl xl:grid-cols-[1.2fr_1fr_1fr_auto]">
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("placeholders.email")}
            type="email"
            className="h-11 rounded-2xl"
          />
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("placeholders.usernameOptional")}
            className="h-11 rounded-2xl"
          />
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("placeholders.temporaryPassword")}
            type="password"
            className="h-11 rounded-2xl"
          />
          <Button
            onClick={() => void submit()}
            disabled={!email.trim() || !password.trim() || isSubmitting}
            className="h-11 rounded-2xl px-5"
          >
            {isSubmitting ? t("actions.submitting") : t("actions.createUser")}
          </Button>
        </div>
      </div>
    </AdminPanel>
  )
}

export function UsersAdminPage() {
  const t = useTranslations("admin.usersPage")
  const common = useTranslations("admin.common")
  const locale = useLocale()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "superuser">("all")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(["admin/users", query, status], () =>
    fetchAdminUsers({
      limit: 100,
      email: query.trim() || undefined,
      is_active: status === "active" ? true : status === "inactive" ? false : undefined,
      is_superuser: status === "superuser" ? true : undefined,
    })
  )

  const rows = data?.items ?? []

  const metrics = useMemo(() => {
    const active = rows.filter((user) => user.is_active).length
    const admins = rows.filter((user) => user.is_superuser).length
    return [
      { label: t("stats.totalUsers"), value: data?.total ?? rows.length, icon: Users, tone: "blue" as const },
      { label: t("stats.active"), value: active, icon: UserCheck, tone: "emerald" as const },
      { label: t("stats.superusers"), value: admins, icon: Shield, tone: "amber" as const },
      { label: t("stats.inactive"), value: rows.length - active, icon: X, tone: "rose" as const },
    ]
  }, [data?.total, rows, t])

  const statusLabels: Record<typeof status, string> = {
    all: common("all"),
    active: t("status.active"),
    inactive: t("status.inactive"),
    superuser: t("status.superuser"),
  }

  async function toggleUser(
    user: AdminUserItem,
    patch: { is_active?: boolean; is_superuser?: boolean }
  ) {
    setUpdatingId(user.id)
    try {
      await updateAdminUser(user.id, patch)
      await mutate()
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <AdminPageShell
      eyebrow={t("consoleLabel")}
      title={t("consoleTitle")}
      description={t("consoleDescription")}
    >
      <AdminMetricGrid metrics={metrics} />
      <CreateUserPanel onCreated={() => void mutate()} />

      <AdminPanel>
        <div className="flex flex-col gap-3 border-b border-[var(--hairline)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            className="h-11 rounded-2xl lg:max-w-md"
          />
          <div className="flex flex-wrap gap-2">
            {(["all", "active", "inactive", "superuser"] as const).map((value) => (
              <Button
                key={value}
                variant={status === value ? "default" : "outline"}
                className="rounded-full capitalize"
                onClick={() => setStatus(value)}
              >
                {statusLabels[value]}
              </Button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-[color-mix(in_srgb,var(--window-bg)_72%,transparent)] text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
              <tr>
                <th className="px-5 py-4 font-semibold">{t("table.headers.email")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.status")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.superuser")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.registered")}</th>
                <th className="px-5 py-4 text-right font-semibold">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[var(--ink-3)]">
                    {t("empty.loading")}
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-rose-500">
                    {t("empty.failed")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[var(--ink-3)]">
                    {t("empty.noData")}
                  </td>
                </tr>
              ) : (
                rows.map((user) => (
                  <tr
                    key={user.id}
                    className="transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_3%,transparent)]"
                  >
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className="space-y-1 text-left"
                      >
                        <div className="font-semibold text-[var(--ink)] hover:underline">
                          {user.email}
                        </div>
                        <div className="font-mono text-xs text-[var(--ink-3)]">
                          {user.username || user.id}
                        </div>
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <AdminStatusPill
                        active={user.is_active}
                        label={user.is_active ? t("status.active") : t("status.inactive")}
                      />
                    </td>
                    <td className="px-5 py-4 text-[var(--ink-2)]">
                      {user.is_superuser
                        ? t("filters.superuser.yes")
                        : t("filters.superuser.no")}
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--ink-3)]">
                      {formatDate(user.created_at, locale)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={updatingId === user.id}
                          onClick={() =>
                            void toggleUser(user, { is_active: !user.is_active })
                          }
                        >
                          {user.is_active ? t("actions.deactivate") : t("actions.activate")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={updatingId === user.id}
                          onClick={() =>
                            void toggleUser(user, { is_superuser: !user.is_superuser })
                          }
                        >
                          {user.is_superuser
                            ? t("actions.demoteSuperuser")
                            : t("actions.promoteSuperuser")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
      <UserDrawer
        userId={selectedUserId}
        locale={locale}
        onClose={() => setSelectedUserId(null)}
      />
    </AdminPageShell>
  )
}
