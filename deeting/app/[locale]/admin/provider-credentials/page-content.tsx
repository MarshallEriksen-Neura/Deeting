"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Key } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  type ColumnDef,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  createAdminProviderCredential,
  fetchAdminProviderCredentials,
  fetchAdminProviderInstances,
  type ProviderCredentialItem,
} from "@/lib/api/admin-dashboard"

type ProviderCredentialRow = ProviderCredentialItem & {
  instance_name: string
  preset_slug: string
}

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState("")
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const [alias, setAlias] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
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
      setFeedback(`Created credential: ${created.alias}`)
      await mutate()
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Create failed"
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: ColumnDef<ProviderCredentialRow>[] = [
    {
      key: "instance_name",
      header: "Instance",
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
      header: "Alias",
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--foreground)]">{row.alias}</span>,
    },
    {
      key: "secret_ref",
      header: "Secret Ref",
      render: () => <span className="font-mono text-xs text-[var(--muted)]">hidden</span>,
    },
    {
      key: "weight",
      header: "Weight",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.weight}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "is_active",
      header: "Active",
      render: (row) => (
        <AdminStatusBadge text={row.is_active ? "active" : "inactive"} tone={row.is_active ? "success" : "error"} />
      ),
    },
    {
      key: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{new Date(row.updated_at).toLocaleDateString()}</span>
      ),
    },
  ]

  const isLoading = instancesLoading || credentialsLoading
  const hasError = instancesError || credentialError

  return (
    <AdminPageShell
      title="Provider Credentials"
      description="Manage API keys and credentials for providers"
      icon={Key}
    >
      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <select
            value={selectedInstanceId}
            onChange={(event) => setSelectedInstanceId(event.target.value)}
            className="h-9 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
          >
            <option value="">Select instance</option>
            {(instances ?? []).map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
          <input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="Credential alias"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Provider API key"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <button
            onClick={() => void handleCreateCredential()}
            disabled={!selectedInstanceId || !alias.trim() || !apiKey.trim() || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Add Credential"}
          </button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder="Search credentials..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "active") setActiveFilter(value)
        }}
        filters={[
          {
            key: "active",
            label: "Active",
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
          isLoading
            ? "Loading credentials..."
            : hasError
              ? "Failed to load credentials"
              : "No credentials found"
        }
      />
    </AdminPageShell>
  )
}
