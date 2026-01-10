"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Key, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { type ApiKey, type CreateApiKeyRequest } from "@/lib/api/api-keys"
import { type ApiError } from "@/lib/http"
import { useApiKeyService } from "@/hooks/use-api-keys"
import { useApiKeyDrawerStore } from "@/store/api-key-drawer-store"
import { useAvailableModels } from "@/hooks/use-available-models"
import { Container } from "@/components/ui/container"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiKeyStrip, MintKeyDrawer, KeyRevealModal } from "@/components/api-keys"

export function ApiKeysPageClient() {
  const t = useTranslations("apiKeys")

  const { open, setOpen, openDrawer, closeDrawer } = useApiKeyDrawerStore()
  const [revealModalOpen, setRevealModalOpen] = React.useState(false)
  const [newKeySecret, setNewKeySecret] = React.useState<string | null>(null)
  const [newKeyName, setNewKeyName] = React.useState<string>("")

  const { apiKeys, isLoading, error, createKey, rollKey, revokeKey, refresh, mutations } =
    useApiKeyService()
  const { models: availableModels, isLoading: modelsLoading } = useAvailableModels()

  const activeKeys = React.useMemo(
    () => apiKeys.filter((k) => k.status === "active" || k.status === "limited"),
    [apiKeys]
  )
  const inactiveKeys = React.useMemo(
    () => apiKeys.filter((k) => k.status === "revoked" || k.status === "expired"),
    [apiKeys]
  )

  React.useEffect(() => {
    if (error) {
      toast.error(error.message || t("toast.loadFailed"))
    }
  }, [error, t])

  const handleCreateKey = React.useCallback(
    async (data: CreateApiKeyRequest) => {
      try {
        const res = await createKey(data)
        setNewKeySecret(res.secret)
        setNewKeyName(res.api_key.name)
        closeDrawer()
        setRevealModalOpen(true)
        toast.success(t("toast.createSuccess"))
      } catch (err) {
        const apiErr = err as ApiError
        toast.error(apiErr.message || t("toast.createFailed"))
        throw err
      }
    },
    [createKey, closeDrawer, t]
  )

  const handleRoll = React.useCallback(
    async (key: ApiKey) => {
      try {
        const res = await rollKey(key.id)
        setNewKeySecret(res.secret)
        setNewKeyName(key.name)
        setRevealModalOpen(true)
        toast.success(t("toast.rollSuccess"))
      } catch (err) {
        const apiErr = err as ApiError
        toast.error(apiErr.message || t("toast.rollFailed"))
      }
    },
    [rollKey, t]
  )

  const handleRevoke = React.useCallback(
    async (key: ApiKey) => {
      try {
        await revokeKey(key.id)
        toast.success(t("toast.revokeSuccess"))
      } catch (err) {
        const apiErr = err as ApiError
        toast.error(apiErr.message || t("toast.revokeFailed"))
      }
    },
    [revokeKey, t]
  )

  const handleRevealClose = React.useCallback(() => {
    setRevealModalOpen(false)
    setTimeout(() => {
      setNewKeySecret(null)
      setNewKeyName("")
    }, 300)
  }, [])

  const hasKeys = apiKeys.length > 0
  const showEmpty = !isLoading && !hasKeys && !error

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl flex items-center gap-3">
            <Key className="size-7 text-[var(--primary)]" />
            {t("title")}
          </h1>
          <p className="mt-1 text-[var(--muted)]">{t("subtitle")}</p>
        </div>
        <GlassButton onClick={openDrawer} loading={mutations.create.isMutating}>
          <Plus className="size-4" />
          {t("mintNew")}
        </GlassButton>
      </div>

      {isLoading ? (
        <ApiKeysSkeleton />
      ) : error ? (
        <ErrorState onRetry={refresh} />
      ) : showEmpty ? (
        <EmptyState onMint={openDrawer} />
      ) : (
        <div className="space-y-8">
          {activeKeys.length > 0 && (
            <div className="space-y-4">
              {activeKeys.map((key, index) => (
                <ApiKeyStrip
                  key={key.id}
                  apiKey={key}
                  onRoll={handleRoll}
                  onRevoke={handleRevoke}
                  className={cn("animate-glass-card-in", `stagger-${index + 1}`)}
                />
              ))}
            </div>
          )}

          {inactiveKeys.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">
                {t("inactiveTitle")}
              </h2>
              {inactiveKeys.map((key, index) => (
                <ApiKeyStrip
                  key={key.id}
                  apiKey={key}
                  onRoll={handleRoll}
                  onRevoke={handleRevoke}
                  className={cn(
                    "animate-glass-card-in",
                    `stagger-${activeKeys.length + index + 1}`
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <MintKeyDrawer
        open={open}
        onOpenChange={setOpen}
        onSubmit={handleCreateKey}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
      />
        availableModels={availableModels}

      <KeyRevealModal
        open={revealModalOpen}
        onOpenChange={handleRevealClose}
        secret={newKeySecret}
        keyName={newKeyName}
      />
    </Container>
  )
}

function EmptyState({ onMint }: { onMint: () => void }) {
  const t = useTranslations("apiKeys.empty")

  return (
    <GlassCard className="py-16 text-center">
      <GlassCardContent className="flex flex-col items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-[var(--primary)]/10">
          <Key className="size-8 text-[var(--primary)]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {t("title")}
          </h3>
          <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
        </div>
        <GlassButton onClick={onMint} className="mt-4">
          <Plus className="size-4" />
          {t("title")}
        </GlassButton>
      </GlassCardContent>
    </GlassCard>
  )
}

function ApiKeysSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((item) => (
        <GlassCard key={item}>
          <GlassCardContent className="p-4 pl-5 flex items-center gap-4">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-4 w-24 hidden sm:block" />
            <Skeleton className="h-4 w-20 hidden md:block" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </GlassCardContent>
        </GlassCard>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("apiKeys")

  return (
    <GlassCard className="py-12 text-center">
      <GlassCardContent className="flex flex-col items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
          <RefreshCw className="size-5 text-red-500" />
        </div>
        <p className="text-sm text-[var(--muted)]">{t("toast.loadFailed")}</p>
        <GlassButton onClick={onRetry} variant="secondary">
          <RefreshCw className="size-4" />
          {t("actions.retry")}
        </GlassButton>
      </GlassCardContent>
    </GlassCard>
  )
}

export default ApiKeysPageClient
