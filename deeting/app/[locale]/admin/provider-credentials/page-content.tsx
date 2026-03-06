"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"

import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  type ColumnDef,
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
  createAdminProviderCredential,
  deleteAdminProviderCredential,
  fetchAdminProviderCredentials,
  fetchAdminProviderInstances,
  type ProviderCredentialItem,
} from "@/lib/api/admin-dashboard"

type ProviderCredentialRow = ProviderCredentialItem & {
  instance_name: string
  preset_slug: string
}

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const t = useTranslations("admin.providerCredentialsPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState("")
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const [alias, setAlias] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data: instances,
    error: instancesError,
    isLoading: instancesLoading,
  } = useSWR("/api/v1/admin/provider-instances", fetchAdminProviderInstances)

  const instanceKey = useMemo(
    () => (instances ?? []).map((instance) => instance.id).join(","),
    [instances]
  )

  const {
    data: allRows,
    error: credentialError,
    isLoading: credentialsLoading,
    mutate,
  } = useSWR(
    instances?.length ? ["/api/v1/admin/provider-credentials", instanceKey] : null,
    async () => {
      const grouped = await Promise.all(
        (instances ?? []).map(async (instance) => {
          const credentials = await fetchAdminProviderCredentials(instance.id)
          return credentials.map((credential) => ({
            ...credential,
            instance_name: instance.name,
            preset_slug: instance.preset_slug,
          }))
        })
      )
      return grouped.flat()
    }
  )

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return (allRows ?? []).filter((row) => {
      if (activeFilter === "true" && !row.is_active) return false
      if (activeFilter === "false" && row.is_active) return false
      if (!query) return true
      return [row.instance_name, row.preset_slug, row.alias, row.id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, activeFilter])

  const handleCreateCredential = async () => {
    if (!selectedInstanceId || !alias.trim() || !apiKey.trim() || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const created = await createAdminProviderCredential(selectedInstanceId, {
        alias: alias.trim(),
        api_key: apiKey.trim(),
      })
      setAlias("")
      setApiKey("")
      setFeedback(t("feedback.created", { alias: created.alias }))
      await mutate()
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("feedback.createFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteCredential = async (row: ProviderCredentialRow) => {
    if (deletingId) return
    if (!window.confirm(t("confirm.delete", { alias: row.alias }))) return

    setDeletingId(row.id)
    setFeedback(null)
    try {
      await deleteAdminProviderCredential(row.instance_id, row.id)
      setFeedback(t("feedback.deleted", { alias: row.alias }))
      await mutate()
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : t("feedback.deleteFailed")
      setFeedback(message)
    } finally {
      setDeletingId(null)
    }
  }

  const columns: ColumnDef<ProviderCredentialRow>[] = [
    {
      key: "instance_name",
      header: t("table.headers.instance"),
      sortable: true,
      render: (row) => (
        <div>
          <span className="font-medium text-[var(--foreground)]">{row.instance_name}</span>
          <div className="text-xs text-[var(--muted)]">{row.preset_slug}</div>
        </div>
      ),
    },
    {
      key: "alias",
      header: t("table.headers.alias"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--foreground)]">{row.alias}</span>,
    },
    {
      key: "secret_ref",
      header: t("table.headers.secretRef"),
      render: () => <span className="font-mono text-xs text-[var(--muted)]">{t("table.hidden")}</span>,
    },
    {
      key: "weight",
      header: t("table.headers.weight"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.weight}</span>,
    },
    {
      key: "priority",
      header: t("table.headers.priority"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "is_active",
      header: t("table.headers.active"),
      render: (row) => (
        <AdminStatusBadge
          text={row.is_active ? t("status.active") : t("status.inactive")}
          tone={row.is_active ? "success" : "error"}
        />
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

  const isLoading = instancesLoading || credentialsLoading
  const hasError = instancesError || credentialError

  return (
    <>
      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={selectedInstanceId || "__none__"} onValueChange={(v) => setSelectedInstanceId(v === "__none__" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder={t("form.selectInstance")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("form.selectInstance")}</SelectItem>
              {(instances ?? []).map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder={t("form.credentialAlias")}
          />
          <Input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t("form.providerApiKey")}
          />
          <Button
            onClick={() => void handleCreateCredential()}
            disabled={!selectedInstanceId || !alias.trim() || !apiKey.trim() || isSubmitting}
            size="sm"
          >
            {isSubmitting ? t("actions.creating") : t("actions.addCredential")}
          </Button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "active") setActiveFilter(value)
        }}
        filters={[
          {
            key: "active",
            label: t("filters.active"),
            options: [
              { label: t("status.yes"), value: "true" },
              { label: t("status.no"), value: "false" },
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
            : hasError
              ? t("empty.failed")
              : t("empty.noData")
        }
        rowActions={(row) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              void handleDeleteCredential(row)
            }}
            disabled={Boolean(deletingId)}
          >
            {t("actions.delete")}
          </Button>
        )}
      />
    </>
  )
}
