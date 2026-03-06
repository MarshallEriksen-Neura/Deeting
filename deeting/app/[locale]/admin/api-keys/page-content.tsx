"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"

import {
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createAdminApiKey,
  deleteAdminApiKey,
  fetchAdminApiKeys,
  revokeAdminApiKey,
  rotateAdminApiKey,
  type AdminApiKeyItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const t = useTranslations("admin.apiKeysPage")
  const locale = useLocale()
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
  const [actioningId, setActioningId] = useState<string | null>(null)

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
    { label: t("stats.totalKeys"), value: total, color: "primary" },
    { label: t("stats.active"), value: active, color: "emerald" },
    { label: t("stats.revoked"), value: revoked, color: "rose" },
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
      setFeedback(t("feedback.created", { name: created.api_key.name }))
      await mutate()
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("feedback.createFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const typeTextMap: Record<string, string> = {
    internal: t("types.internal"),
    external: t("types.external"),
  }
  const statusTextMap: Record<string, string> = {
    active: t("status.active"),
    expiring: t("status.expiring"),
    revoked: t("status.revoked"),
    expired: t("status.expired"),
  }

  const handleRevokeKey = async (row: AdminApiKeyItem) => {
    if (actioningId) return
    if (row.status !== "active") return
    if (!window.confirm(t("confirm.revoke", { name: row.name }))) return

    setActioningId(row.id)
    setFeedback(null)
    try {
      await revokeAdminApiKey(row.id)
      setFeedback(t("feedback.revoked", { name: row.name }))
      await mutate()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("feedback.revokeFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  const handleRotateKey = async (row: AdminApiKeyItem) => {
    if (actioningId) return
    if (!window.confirm(t("confirm.rotate", { name: row.name }))) return

    setActioningId(row.id)
    setFeedback(null)
    setRawKey(null)
    try {
      const rotated = await rotateAdminApiKey(row.id, {
        grace_period_hours: 24,
      })
      setFeedback(t("feedback.rotated", { name: row.name }))
      setRawKey(rotated.raw_key)
      await mutate()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("feedback.rotateFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  const handleDeleteKey = async (row: AdminApiKeyItem) => {
    if (actioningId) return
    if (!window.confirm(t("confirm.delete", { name: row.name }))) return

    setActioningId(row.id)
    setFeedback(null)
    try {
      await deleteAdminApiKey(row.id)
      setFeedback(t("feedback.deleted", { name: row.name }))
      await mutate()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("feedback.deleteFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  const columns: ColumnDef<AdminApiKeyItem>[] = [
    {
      key: "name",
      header: t("table.headers.name"),
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
      header: t("table.headers.type"),
      render: (row) => (
        <AdminStatusBadge
          text={typeTextMap[row.type] ?? row.type}
          tone={getStatusTone(row.type)}
          dot={false}
        />
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge text={statusTextMap[row.status] ?? row.status} tone={getStatusTone(row.status)} />
      ),
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "tenant_id",
      header: t("table.headers.tenant"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{formatDate(row.created_at, locale)}</span>
      ),
    },
    {
      key: "last_used_at",
      header: t("table.headers.lastUsed"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.last_used_at ? formatDate(row.last_used_at, locale) : t("table.never")}
        </span>
      ),
    },
  ]

  return (
    <>
      <AdminStatCards stats={stats} columns={3} />

      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("form.keyName")}
          />
          <Select value={keyType} onValueChange={(v) => setKeyType(v as "internal" | "external")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">{t("types.internal")}</SelectItem>
              <SelectItem value="external">{t("types.external")}</SelectItem>
            </SelectContent>
          </Select>
          {keyType === "internal" ? (
            <Input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder={t("form.userId")}
              className="font-mono"
            />
          ) : (
            <Input
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder={t("form.tenantId")}
              className="font-mono"
            />
          )}
          <Input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <Button
            onClick={() => void handleCreateKey()}
            disabled={!canCreate || isSubmitting}
            size="sm"
          >
            {isSubmitting ? t("actions.creating") : t("actions.create")}
          </Button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
        {rawKey && (
          <p className="mt-1 font-mono text-xs text-amber-300">
            {t("feedback.rawKeyLabel")}: {rawKey}
          </p>
        )}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: t("filters.type"),
            options: [
              { label: t("types.internal"), value: "internal" },
              { label: t("types.external"), value: "external" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.active"), value: "active" },
              { label: t("status.expiring"), value: "expiring" },
              { label: t("status.revoked"), value: "revoked" },
              { label: t("status.expired"), value: "expired" },
            ],
          },
        ]}
      />
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
          <div className="inline-flex items-center gap-1">
            {row.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleRevokeKey(row)
                }}
                disabled={Boolean(actioningId)}
              >
                {t("actions.revoke")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleRotateKey(row)
              }}
              disabled={Boolean(actioningId)}
            >
              {t("actions.rotate")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleDeleteKey(row)
              }}
              disabled={Boolean(actioningId)}
            >
              {t("actions.delete")}
            </Button>
          </div>
        )}
      />
    </>
  )
}
