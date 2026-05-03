"use client"

import * as React from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { useLocale } from "next-intl"
import { toast } from "sonner"

import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/shadcn/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import { Switch } from "@/ui/shadcn/switch"
import { GlassButton } from "@/ui/common/glass-button"
import { useI18n } from "@/hooks/use-i18n"
import { cn } from "@/lib/utils"
import {
  createLocalAiAccessKey,
  deriveKeyAccentHue,
  formatRelativeTime,
  getLocalAiAccessGatewayConfig,
  listLocalAiAccessKeys,
  revokeLocalAiAccessKey,
  setLocalAiAccessGatewayConfig,
  startLocalAiAccessGateway,
  type LocalAiAccessGatewayConfig,
  type LocalAiAccessKeyRecord,
} from "@/lib/api/ai-access"

interface DesktopAiAccessSettingsCardProps {
  isTauriRuntime: boolean
}

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 17321
const DEFAULT_SCOPES = ["engine:chat"]

type CopyTarget = "base-url" | "secret" | string

type Translator = ReturnType<typeof useI18n>

export function DesktopAiAccessSettingsCard({
  isTauriRuntime,
}: DesktopAiAccessSettingsCardProps) {
  const t = useI18n("settings")
  const locale = useLocale()

  const [config, setConfig] = React.useState<LocalAiAccessGatewayConfig | null>(
    null,
  )
  const [enabled, setEnabled] = React.useState(false)
  const [port, setPort] = React.useState<string>(String(DEFAULT_PORT))
  const [keys, setKeys] = React.useState<LocalAiAccessKeyRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSavingGateway, setIsSavingGateway] = React.useState(false)
  const [revokeTarget, setRevokeTarget] =
    React.useState<LocalAiAccessKeyRecord | null>(null)
  const [revokingId, setRevokingId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [isCreating, setIsCreating] = React.useState(false)
  const [revealedSecret, setRevealedSecret] = React.useState<{
    name: string
    secret: string
    keyPrefix: string
  } | null>(null)
  const [copyState, setCopyState] = React.useState<{
    target: CopyTarget
    ts: number
  } | null>(null)

  const loadAll = React.useCallback(async () => {
    if (!isTauriRuntime) return
    setIsLoading(true)
    try {
      const [nextConfig, nextKeys] = await Promise.all([
        getLocalAiAccessGatewayConfig(),
        listLocalAiAccessKeys(),
      ])
      setConfig(nextConfig)
      setEnabled(nextConfig.enabled)
      setPort(String(nextConfig.port))
      setKeys(nextKeys)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error)
      toast.error(t("aiAccess.toast.loadFailed", { error: message }))
    } finally {
      setIsLoading(false)
    }
  }, [isTauriRuntime, t])

  React.useEffect(() => {
    void loadAll()
  }, [loadAll])

  if (!isTauriRuntime) {
    return null
  }

  const baseUrl = config?.base_url ?? null
  const isRunning = enabled && Boolean(baseUrl)

  const dirtyEnabled = enabled !== (config?.enabled ?? false)
  const dirtyPort = port.trim() !== String(config?.port ?? DEFAULT_PORT)
  const hasGatewayChanges = dirtyEnabled || dirtyPort

  const activeCount = keys.filter((k) => k.status === "active").length

  const handleCopy = async (target: CopyTarget, value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopyState({ target, ts: Date.now() })
      window.setTimeout(() => {
        setCopyState((prev) => (prev?.target === target ? null : prev))
      }, 1600)
    } catch {
      toast.error(t("aiAccess.toast.copyFailed"))
    }
  }

  const handleSaveGateway = async () => {
    setIsSavingGateway(true)
    try {
      const portNum = Number.parseInt(port, 10)
      if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
        toast.error(t("aiAccess.toast.portInvalid"))
        return
      }
      const next = await setLocalAiAccessGatewayConfig({
        enabled,
        host: DEFAULT_HOST,
        port: portNum,
      })
      setConfig(next)
      setEnabled(next.enabled)
      setPort(String(next.port))
      if (next.enabled) {
        try {
          const started = await startLocalAiAccessGateway()
          setConfig(started)
        } catch (startError) {
          const message =
            startError instanceof Error
              ? startError.message
              : String(startError)
          toast.error(t("aiAccess.toast.startFailed", { error: message }))
          return
        }
      }
      toast.success(t("aiAccess.toast.gatewaySaved"))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t("aiAccess.toast.saveFailed", { error: message }))
    } finally {
      setIsSavingGateway(false)
    }
  }

  const handleCreateKey = async () => {
    const name = createName.trim()
    if (!name) {
      toast.error(t("aiAccess.toast.nameRequired"))
      return
    }
    setIsCreating(true)
    try {
      const created = await createLocalAiAccessKey({
        name,
        scopes: DEFAULT_SCOPES,
      })
      setKeys((prev) => [created.key, ...prev])
      setRevealedSecret({
        name: created.key.name,
        secret: created.secret,
        keyPrefix: created.key.key_prefix,
      })
      setCreateName("")
      setCreateOpen(false)
      toast.success(t("aiAccess.toast.createSuccess"))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t("aiAccess.toast.createFailed", { error: message }))
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return
    setRevokingId(revokeTarget.id)
    try {
      const ok = await revokeLocalAiAccessKey(revokeTarget.id)
      if (ok) {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === revokeTarget.id
              ? {
                  ...k,
                  status: "revoked",
                  revoked_at: new Date().toISOString(),
                }
              : k,
          ),
        )
        toast.success(t("aiAccess.toast.revokeSuccess"))
      } else {
        toast(t("aiAccess.toast.revokeNoop"))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t("aiAccess.toast.revokeFailed", { error: message }))
    } finally {
      setRevokeTarget(null)
      setRevokingId(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)]/70 backdrop-blur-sm shadow-[var(--elev-floating)] transition-colors">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hairline)] px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <KeyRound className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("aiAccess.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("aiAccess.description")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium",
              isRunning
                ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                : "border-[var(--hairline-strong)]",
            )}
          >
            <span className="relative inline-flex h-1.5 w-1.5">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full",
                  isRunning ? "bg-emerald-500" : "bg-muted-foreground/50",
                )}
              />
              {isRunning ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              ) : null}
            </span>
            {t(
              isRunning
                ? "aiAccess.badge.running"
                : "aiAccess.badge.stopped",
            )}
          </Badge>
          <Badge
            variant="secondary"
            className="font-mono text-[10px] tracking-wide tabular-nums"
          >
            :{config?.port ?? port ?? DEFAULT_PORT}
          </Badge>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-6 px-6 py-5">
        {/* 01 — Gateway */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-3)]">
              01 — {t("aiAccess.gateway.sectionTitle")}
            </span>
            <span className="h-px flex-1 bg-[var(--hairline)]" />
          </div>

          <div className="rounded-xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg-inset)_72%,white_28%)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <label
                className="flex items-center gap-3"
                htmlFor="ai-access-enabled"
              >
                <Switch
                  id="ai-access-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={isLoading || isSavingGateway}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {t("aiAccess.gateway.enabledLabel")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      enabled
                        ? "aiAccess.gateway.enableHint"
                        : "aiAccess.gateway.disableHint",
                    )}
                  </p>
                </div>
              </label>

              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="ai-access-port"
                    className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {t("aiAccess.gateway.portLabel")}
                  </Label>
                  <Input
                    id="ai-access-port"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={port}
                    onChange={(e) =>
                      setPort(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    disabled={isLoading || isSavingGateway}
                    className="h-8 w-24 font-mono text-sm tabular-nums"
                    placeholder={String(DEFAULT_PORT)}
                  />
                </div>
                <GlassButton
                  size="sm"
                  type="button"
                  onClick={handleSaveGateway}
                  loading={isSavingGateway}
                  disabled={!hasGatewayChanges || isLoading}
                >
                  {t("aiAccess.gateway.saveAction")}
                </GlassButton>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg)]/80 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t("aiAccess.gateway.baseUrlLabel")}
                  </p>
                  <p
                    className={cn(
                      "truncate font-mono text-[13px]",
                      baseUrl
                        ? "text-foreground"
                        : "italic text-muted-foreground/70",
                    )}
                    title={baseUrl ?? undefined}
                  >
                    {baseUrl ?? t("aiAccess.gateway.baseUrlEmpty")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => baseUrl && handleCopy("base-url", baseUrl)}
                  disabled={!baseUrl}
                >
                  {copyState?.target === "base-url" ? (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      {t("aiAccess.gateway.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-3 w-3" />
                      {t("aiAccess.gateway.copyBaseUrl")}
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("aiAccess.gateway.baseUrlHelp")}
              </p>
            </div>
          </div>
        </section>

        {/* 02 — API keys */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-3)]">
              02 — {t("aiAccess.keys.sectionTitle")}
            </span>
            <span className="h-px flex-1 bg-[var(--hairline)]" />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t("aiAccess.keys.countLabel", {
                active: activeCount,
                total: keys.length,
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCreateOpen(true)}
              disabled={isLoading}
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("aiAccess.keys.createAction")}
            </Button>
          </div>

          {isLoading && keys.length === 0 ? (
            <KeysSkeleton />
          ) : keys.length === 0 ? (
            <EmptyKeys onCreate={() => setCreateOpen(true)} t={t} />
          ) : (
            <ul className="space-y-2">
              {keys.map((record) => (
                <KeyRow
                  key={record.id}
                  record={record}
                  locale={locale}
                  copying={copyState?.target === `prefix-${record.id}`}
                  revoking={revokingId === record.id}
                  onCopyPrefix={() =>
                    handleCopy(
                      `prefix-${record.id}`,
                      record.key_prefix,
                    )
                  }
                  onRevoke={() => setRevokeTarget(record)}
                  t={t}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] px-6 py-3">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" />
          {t("aiAccess.footerHint")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={loadAll}
          disabled={isLoading}
        >
          <RefreshCw
            className={cn("mr-1 h-3 w-3", isLoading && "animate-spin")}
          />
          {t("aiAccess.refresh")}
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => !isCreating && setCreateOpen(o)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("aiAccess.create.title")}</DialogTitle>
            <DialogDescription>
              {t("aiAccess.create.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="ai-access-create-name"
                className="text-xs font-medium"
              >
                {t("aiAccess.create.nameLabel")}
              </Label>
              <Input
                id="ai-access-create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t("aiAccess.create.namePlaceholder")}
                disabled={isCreating}
                maxLength={64}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                {t("aiAccess.create.nameHelp")}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("aiAccess.create.scopeLabel")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DEFAULT_SCOPES.map((scope) => (
                  <Badge
                    key={scope}
                    variant="secondary"
                    className="font-mono text-[10px]"
                  >
                    {scope}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("aiAccess.create.scopeHelp")}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={isCreating}
            >
              {t("aiAccess.create.cancel")}
            </Button>
            <GlassButton
              type="button"
              onClick={handleCreateKey}
              loading={isCreating}
              disabled={!createName.trim()}
            >
              {t("aiAccess.create.submit")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal-secret dialog (one-time) */}
      <Dialog
        open={Boolean(revealedSecret)}
        onOpenChange={(o) => !o && setRevealedSecret(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500" />
              {t("aiAccess.reveal.title", {
                name: revealedSecret?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("aiAccess.reveal.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("aiAccess.reveal.warning")}</span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)]/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("aiAccess.reveal.secretLabel")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-[var(--panel-bg)] px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                  {revealedSecret?.secret}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() =>
                    revealedSecret &&
                    handleCopy("secret", revealedSecret.secret)
                  }
                >
                  {copyState?.target === "secret" ? (
                    <>
                      <Check className="mr-1 h-3.5 w-3.5" />
                      {t("aiAccess.gateway.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      {t("aiAccess.reveal.copySecret")}
                    </>
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-1 rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/60 p-3 text-[11px] text-muted-foreground">
              <p>{t("aiAccess.reveal.usage1")}</p>
              <p>
                {t("aiAccess.reveal.usage2")}{" "}
                <code className="font-mono">
                  {baseUrl ?? t("aiAccess.gateway.baseUrlEmpty")}
                </code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <GlassButton
              onClick={() => setRevealedSecret(null)}
              type="button"
            >
              {t("aiAccess.reveal.confirm")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) =>
          !open && !revokingId && setRevokeTarget(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("aiAccess.revokeConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("aiAccess.revokeConfirm.description", {
                name: revokeTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(revokingId)}>
              {t("aiAccess.revokeConfirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              className="bg-red-600 hover:bg-red-700"
              disabled={Boolean(revokingId)}
            >
              {revokingId
                ? t("aiAccess.revokeConfirm.revoking")
                : t("aiAccess.revokeConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* --------------------------------- Sub-views --------------------------------- */

function KeysSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[70px] animate-pulse rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/40"
        />
      ))}
    </div>
  )
}

interface EmptyKeysProps {
  onCreate: () => void
  t: Translator
}

function EmptyKeys({ onCreate, t }: EmptyKeysProps) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--hairline-strong)] bg-[var(--panel-bg-inset)]/40 px-5 py-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <KeyRound className="h-4.5 w-4.5" />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">
        {t("aiAccess.empty.title")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("aiAccess.empty.description")}
      </p>
      <div className="mt-3 flex justify-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onCreate}
        >
          <Plus className="mr-1 h-3 w-3" />
          {t("aiAccess.empty.action")}
        </Button>
      </div>
    </div>
  )
}

interface KeyRowProps {
  record: LocalAiAccessKeyRecord
  locale: string
  copying: boolean
  revoking: boolean
  onCopyPrefix: () => void
  onRevoke: () => void
  t: Translator
}

function KeyRow({
  record,
  locale,
  copying,
  revoking,
  onCopyPrefix,
  onRevoke,
  t,
}: KeyRowProps) {
  const isActive = record.status === "active"
  const hue = deriveKeyAccentHue(record.id)
  const created = formatRelativeTime(record.created_at, locale)
  const lastUsed = record.last_used_at
    ? formatRelativeTime(record.last_used_at, locale)
    : null

  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)]/80 px-4 py-3 transition-colors",
        "hover:border-[var(--hairline-strong)] hover:bg-[color-mix(in_srgb,var(--panel-bg)_70%,white_30%)]",
        !isActive && "opacity-65",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="h-7 w-7 shrink-0 rounded-lg ring-1 ring-inset ring-white/15"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 70% 60%) 0%, hsl(${
              (hue + 40) % 360
            } 65% 55%) 100%)`,
          }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {record.name}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "px-1.5 py-0 text-[10px]",
                isActive
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                  : "border-red-500/40 text-red-600 dark:text-red-400",
              )}
            >
              {t(
                isActive
                  ? "aiAccess.keys.statusActive"
                  : "aiAccess.keys.statusRevoked",
              )}
            </Badge>
            {record.scopes.map((scope) => (
              <Badge
                key={scope}
                variant="secondary"
                className="font-mono text-[10px]"
              >
                {scope}
              </Badge>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={onCopyPrefix}
              className="group/copy inline-flex items-center gap-1 font-mono tracking-wide transition-colors hover:text-foreground"
            >
              <span>{record.key_prefix}…</span>
              {copying ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-50 transition-opacity group-hover/copy:opacity-100" />
              )}
            </button>
            {created ? (
              <span>
                {t("aiAccess.keys.createdAt", { value: created })}
              </span>
            ) : null}
            <span>
              {lastUsed
                ? t("aiAccess.keys.lastUsedAt", { value: lastUsed })
                : t("aiAccess.keys.neverUsed")}
            </span>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isActive ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              onClick={onRevoke}
              disabled={revoking}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {revoking
                ? t("aiAccess.keys.revoking")
                : t("aiAccess.keys.revoke")}
            </Button>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              {t("aiAccess.keys.archived")}
            </Badge>
          )}
        </div>
      </div>
    </li>
  )
}
