"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Users, Shield, UserX, Crown } from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  createAdminUser,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserItem,
} from "@/lib/api/admin-dashboard"

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [superuserFilter, setSuperuserFilter] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/users?limit=100", () => fetchAdminUsers({ limit: 100 }))

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

  const totalUsers = allRows.length
  const activeUsers = allRows.filter((row) => row.is_active).length
  const inactiveUsers = totalUsers - activeUsers
  const superUsers = allRows.filter((row) => row.is_superuser).length

  const stats: StatCardData[] = [
    { label: "Total Users", value: totalUsers, icon: Users, color: "primary" },
    { label: "Active", value: activeUsers, icon: Shield, color: "emerald" },
    { label: "Inactive", value: inactiveUsers, icon: UserX, color: "rose" },
    { label: "Superusers", value: superUsers, icon: Crown, color: "amber" },
  ]

  const handleCreateUser = async () => {
    if (!email.trim() || !password.trim() || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const created = await createAdminUser({
        email: email.trim(),
        password,
        username: username.trim() || undefined,
      })
      setEmail("")
      setUsername("")
      setPassword("")
      setFeedback(`Created user: ${created.email}`)
      await mutate()
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Create failed"
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleActive = async (row: AdminUserItem) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      await updateAdminUser(row.id, { is_active: !row.is_active })
      setFeedback(`${row.email} ${row.is_active ? "deactivated" : "activated"}`)
      await mutate()
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Update failed"
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: ColumnDef<AdminUserItem>[] = [
    {
      key: "username",
      header: "Username",
      sortable: true,
      render: (row) => (
        <span className="font-medium text-[var(--foreground)]">{row.username || "—"}</span>
      ),
    },
    { key: "email", header: "Email", sortable: true },
    {
      key: "is_active",
      header: "Status",
      render: (row) => {
        const status = row.is_active ? "active" : "inactive"
        return <AdminStatusBadge text={status} tone={getStatusTone(status)} />
      },
    },
    {
      key: "is_superuser",
      header: "Superuser",
      render: (row) =>
        row.is_superuser ? (
          <AdminStatusBadge text="superuser" tone="amber" dot={false} />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: "Registered",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {new Date(row.updated_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title="User Management"
      description="Manage users and access status"
      icon={Users}
    >
      <AdminStatCards stats={stats} columns={4} />

      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username (optional)"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Temporary password"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <button
            onClick={() => void handleCreateUser()}
            disabled={!email.trim() || !password.trim() || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Create User"}
          </button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder="Search users by name, email, or id..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "superuser") setSuperuserFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ],
          },
          {
            key: "superuser",
            label: "Superuser",
            options: [
              { label: "Yes", value: "true" },
              { label: "No", value: "false" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading ? "Loading users..." : error ? "Failed to load users" : "No users found"
        }
        rowActions={(row) => (
          <button
            onClick={(event) => {
              event.stopPropagation()
              void handleToggleActive(row)
            }}
            disabled={isSubmitting}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {row.is_active ? "Deactivate" : "Activate"}
          </button>
        )}
      />
    </AdminPageShell>
  )
}
