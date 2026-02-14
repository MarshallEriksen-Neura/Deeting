"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { KeyRound } from "lucide-react"
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
  createAdminApiKey,
  fetchAdminApiKeys,
  type AdminApiKeyItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [name, setName] = useState("")
  const [keyType, setKeyType] = useState<"internal" | "external">("internal")
  const [userId, setUserId] = useState("")
  const [tenantId, setTenantId] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [rawKey, setRawKey] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/api-keys?limit=100", () => fetchAdminApiKeys({ limit: 100 }))

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false
      if (statusFilter && row.status !== statusFilter) return false
      if (!query) return true
      return [row.name, row.id, row.key_prefix, row.key_hint, row.user_id, row.tenant_id].some(
        (value) => String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, typeFilter, statusFilter])

  const total = allRows.length
  const active = allRows.filter((row) => row.status === "active").length
  const revoked = allRows.filter((row) => row.status === "revoked").length

  const stats: StatCardData[] = [
    { label: "Total Keys", value: total, color: "primary" },
    { label: "Active", value: active, color: "emerald" },
    { label: "Revoked", value: revoked, color: "rose" },
  ]

  const canCreate =
    name.trim().length > 0 && (keyType === "internal" ? userId.trim().length > 0 : tenantId.trim().length > 0)

  const handleCreateKey = async () => {
    if (!canCreate || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    setRawKey(null)
    try {
      const created = await createAdminApiKey({
        name: name.trim(),
        type: keyType,
        user_id: keyType === "internal" ? userId.trim() : undefined,
        tenant_id: keyType === "external" ? tenantId.trim() : undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      })
      setName("")
      setUserId("")
      setTenantId("")
      setExpiresAt("")
      setRawKey(created.raw_key)
      setFeedback(`Created key: ${created.api_key.name}`)
      await mutate()
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Create failed"
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: ColumnDef<AdminApiKeyItem>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row) => (
        <div>
          <span className="font-medium text-[var(--foreground)]">{row.name}</span>
          <div className="font-mono text-[10px] text-[var(--muted)]">
            {row.key_prefix}...{row.key_hint}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <AdminStatusBadge text={row.type} tone={getStatusTone(row.type)} dot={false} />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "user_id",
      header: "User",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "tenant_id",
      header: "Tenant",
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</span>
      ),
    },
    {
      key: "last_used_at",
      header: "Last Used",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.last_used_at ? new Date(row.last_used_at).toLocaleDateString() : "Never"}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title="API Key Management"
      description="Manage API keys, ownership, and status"
      icon={KeyRound}
    >
      <AdminStatCards stats={stats} columns={3} />

      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <select
            value={keyType}
            onChange={(event) => setKeyType(event.target.value as "internal" | "external")}
            className="h-9 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
          >
            <option value="internal">internal</option>
            <option value="external">external</option>
          </select>
          {keyType === "internal" ? (
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="User ID (UUID)"
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          ) : (
            <input
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="Tenant ID (UUID)"
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          )}
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <button
            onClick={() => void handleCreateKey()}
            disabled={!canCreate || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create Key"}
          </button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
        {rawKey && (
          <p className="mt-1 font-mono text-xs text-amber-300">Raw key (show once): {rawKey}</p>
        )}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder="Search keys..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { label: "Internal", value: "internal" },
              { label: "External", value: "external" },
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Revoked", value: "revoked" },
              { label: "Expired", value: "expired" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? "Loading API keys..."
            : error
              ? "Failed to load API keys"
              : "No API keys found"
        }
      />
    </AdminPageShell>
  )
}
