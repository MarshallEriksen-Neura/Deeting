"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import {
  ArrowLeft,
  CheckCircle2,
  FileJson2,
  Loader2,
  Plus,
  Radar,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { AdminStatusBadge, getStatusTone } from "@/components/admin"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  createAdminProviderPreset,
  deleteAdminProviderPreset,
  fetchAdminProviderPreset,
  updateAdminProviderPreset,
  verifyAdminProviderPreset,
  type ProviderPresetCreatePayload,
  type ProviderPresetItem,
  type ProviderPresetVerifyResponse,
} from "@/lib/api/admin-dashboard"

type PresetEditorConsoleProps =
  | { mode: "create"; slug?: never }
  | { mode: "edit"; slug: string }

const CREATE_TEMPLATE = {
  protocol_profiles: {
    chat: {
      protocol_family: "openai_chat",
      template_engine: "openai_compat",
      request_builder: "openai_chat_messages_from_canonical",
      upstream_path: "chat/completions",
    },
  },
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseObjectJson(source: string, field: string) {
  if (!source.trim()) {
    return { value: {}, error: null as string | null }
  }
  try {
    const parsed = JSON.parse(source)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: `${field} must be a JSON object` }
    }
    return { value: parsed as Record<string, unknown>, error: null as string | null }
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : `${field} is invalid JSON`,
    }
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function hydrateForm(
  preset: ProviderPresetItem,
  setters: {
    setSlugValue: (value: string) => void
    setName: (value: string) => void
    setProvider: (value: string) => void
    setCategory: (value: string) => void
    setBaseUrl: (value: string) => void
    setUrlTemplate: (value: string) => void
    setThemeColor: (value: string) => void
    setIcon: (value: string) => void
    setAuthType: (value: string) => void
    setProtocolSchemaVersion: (value: string) => void
    setVersion: (value: string) => void
    setIsActive: (value: boolean) => void
    setAuthConfigText: (value: string) => void
    setProtocolProfilesText: (value: string) => void
  }
) {
  setters.setSlugValue(preset.slug ?? "")
  setters.setName(preset.name ?? "")
  setters.setProvider(preset.provider ?? "")
  setters.setCategory(preset.category ?? "")
  setters.setBaseUrl(preset.base_url ?? "")
  setters.setUrlTemplate(preset.url_template ?? "")
  setters.setThemeColor(preset.theme_color ?? "")
  setters.setIcon(preset.icon ?? "")
  setters.setAuthType(preset.auth_type ?? "api_key")
  setters.setProtocolSchemaVersion(preset.protocol_schema_version ?? "")
  setters.setVersion(String(preset.version ?? 1))
  setters.setIsActive(Boolean(preset.is_active))
  setters.setAuthConfigText(prettyJson(preset.auth_config ?? {}))
  setters.setProtocolProfilesText(prettyJson(preset.protocol_profiles ?? {}))
}

function buildCreateDefaults(
  setters: Parameters<typeof hydrateForm>[1]
) {
  setters.setSlugValue("")
  setters.setName("")
  setters.setProvider("")
  setters.setCategory("Cloud API")
  setters.setBaseUrl("")
  setters.setUrlTemplate("")
  setters.setThemeColor("#1E40AF")
  setters.setIcon("lucide:cpu")
  setters.setAuthType("api_key")
  setters.setProtocolSchemaVersion("2026-03-07")
  setters.setVersion("1")
  setters.setIsActive(true)
  setters.setAuthConfigText(prettyJson({}))
  setters.setProtocolProfilesText(prettyJson(CREATE_TEMPLATE.protocol_profiles))
}

export function PresetEditorConsole(props: PresetEditorConsoleProps) {
  const { mode } = props
  const slug = mode === "edit" ? props.slug : null
  const router = useRouter()
  const t = useTranslations("admin.providerPresetsEditor")
  const common = useTranslations("admin.common")

  const { data, error, isLoading, mutate } = useSWR(
    mode === "edit" && slug ? ["/api/v1/admin/provider-presets/detail", slug] : null,
    () => fetchAdminProviderPreset(slug!)
  )

  const [slugValue, setSlugValue] = useState("")
  const [name, setName] = useState("")
  const [provider, setProvider] = useState("")
  const [category, setCategory] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [urlTemplate, setUrlTemplate] = useState("")
  const [themeColor, setThemeColor] = useState("")
  const [icon, setIcon] = useState("")
  const [authType, setAuthType] = useState("api_key")
  const [protocolSchemaVersion, setProtocolSchemaVersion] = useState("")
  const [version, setVersion] = useState("1")
  const [isActive, setIsActive] = useState(true)
  const [authConfigText, setAuthConfigText] = useState("{}")
  const [protocolProfilesText, setProtocolProfilesText] = useState("{}")
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)

  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success")
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [verifyCapability, setVerifyCapability] = useState("chat")
  const [verifyModel, setVerifyModel] = useState("")
  const [verifyPrompt, setVerifyPrompt] = useState("ping")
  const [verifyApiKey, setVerifyApiKey] = useState("")
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<ProviderPresetVerifyResponse | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    const setters = {
      setSlugValue,
      setName,
      setProvider,
      setCategory,
      setBaseUrl,
      setUrlTemplate,
      setThemeColor,
      setIcon,
      setAuthType,
      setProtocolSchemaVersion,
      setVersion,
      setIsActive,
      setAuthConfigText,
      setProtocolProfilesText,
    }

    if (mode === "create") {
      if (hydratedKey !== "create") {
        buildCreateDefaults(setters)
        setHydratedKey("create")
      }
      return
    }

    if (data && hydratedKey !== data.slug) {
      hydrateForm(data, setters)
      setHydratedKey(data.slug ?? slug ?? "edit")
    }
  }, [data, hydratedKey, mode, slug])

  const authConfigState = useMemo(
    () => parseObjectJson(authConfigText, "auth_config"),
    [authConfigText]
  )
  const protocolProfilesState = useMemo(
    () => parseObjectJson(protocolProfilesText, "protocol_profiles"),
    [protocolProfilesText]
  )
  const capabilityOptions = useMemo(() => {
    const value = protocolProfilesState.value
    const keys = value ? Object.keys(value) : []
    return keys.length > 0 ? keys : ["chat"]
  }, [protocolProfilesState.value])

  useEffect(() => {
    if (!capabilityOptions.includes(verifyCapability)) {
      setVerifyCapability(capabilityOptions[0] ?? "chat")
    }
  }, [capabilityOptions, verifyCapability])

  const draftPayload = useMemo(() => {
    const authConfig = authConfigState.value ?? {}
    const protocolProfiles = protocolProfilesState.value ?? {}
    return {
      slug: slugValue.trim(),
      name: name.trim(),
      provider: provider.trim(),
      category: emptyToNull(category),
      base_url: baseUrl.trim(),
      url_template: emptyToNull(urlTemplate),
      theme_color: emptyToNull(themeColor),
      icon: emptyToNull(icon),
      auth_type: authType,
      auth_config: authConfig,
      protocol_schema_version: emptyToNull(protocolSchemaVersion),
      protocol_profiles: protocolProfiles,
      version: Number(version) || 1,
      is_active: isActive,
    }
  }, [
    authConfigState.value,
    authType,
    baseUrl,
    category,
    icon,
    isActive,
    name,
    protocolProfilesState.value,
    protocolSchemaVersion,
    provider,
    slugValue,
    themeColor,
    urlTemplate,
    version,
  ])

  const summaryStatus = isActive ? "active" : "inactive"
  const previewJson = useMemo(() => prettyJson(draftPayload), [draftPayload])

  function validateBeforeSave() {
    if (
      !slugValue.trim() ||
      !name.trim() ||
      !provider.trim() ||
      !baseUrl.trim()
    ) {
      return t("feedback.requiredFields")
    }
    if (authConfigState.error || protocolProfilesState.error) {
      return t("feedback.invalidJson")
    }
    const numericVersion = Number(version)
    if (!Number.isInteger(numericVersion) || numericVersion < 1) {
      return t("feedback.invalidVersion")
    }
    return null
  }

  async function handleSave() {
    setFeedback(null)
    const validationError = validateBeforeSave()
    if (validationError) {
      setFeedbackTone("error")
      setFeedback(validationError)
      return
    }

    setIsSaving(true)
    try {
      if (mode === "create") {
        const created = await createAdminProviderPreset(draftPayload as ProviderPresetCreatePayload)
        setFeedbackTone("success")
        setFeedback(t("feedback.created"))
        router.replace(`/admin/provider-presets/${created.slug}`)
        return
      }

      const updated = await updateAdminProviderPreset(slug!, draftPayload)
      await mutate(updated, false)
      setFeedbackTone("success")
      setFeedback(t("feedback.saved"))
    } catch (saveError) {
      setFeedbackTone("error")
      setFeedback(
        saveError instanceof Error
          ? saveError.message
          : mode === "create"
            ? t("feedback.createFailed")
            : t("feedback.saveFailed")
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (mode !== "edit" || !slug) return
    setIsDeleting(true)
    try {
      await deleteAdminProviderPreset(slug)
      setFeedbackTone("success")
      setFeedback(t("feedback.deleted"))
      router.push("/admin/provider-presets")
    } catch (deleteError) {
      setFeedbackTone("error")
      setFeedback(
        deleteError instanceof Error ? deleteError.message : t("feedback.deleteFailed")
      )
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleVerify() {
    setVerifyError(null)
    setVerifyResult(null)
    if (mode === "create") {
      setVerifyError(t("verify.feedback.saveFirst"))
      return
    }
    if (!verifyApiKey.trim() || !verifyModel.trim()) {
      setVerifyError(t("verify.feedback.missingInputs"))
      return
    }
    if (authConfigState.error || protocolProfilesState.error) {
      setVerifyError(t("feedback.invalidJson"))
      return
    }

    setIsVerifying(true)
    try {
      const result = await verifyAdminProviderPreset(slug!, {
        capability: verifyCapability,
        api_key: verifyApiKey.trim(),
        model: verifyModel.trim(),
        prompt: verifyPrompt.trim() || "ping",
        preset_override: draftPayload,
      })
      setVerifyResult(result)
    } catch (verifyRequestError) {
      setVerifyError(
        verifyRequestError instanceof Error
          ? verifyRequestError.message
          : t("verify.feedback.failed")
      )
    } finally {
      setIsVerifying(false)
    }
  }

  function handleFormatAuthJson() {
    if (!authConfigState.error) {
      setAuthConfigText(prettyJson(authConfigState.value))
    }
  }

  function handleFormatProfilesJson() {
    if (!protocolProfilesState.error) {
      setProtocolProfilesText(prettyJson(protocolProfilesState.value))
    }
  }

  if (mode === "edit" && isLoading) {
    return <p className="text-sm text-[var(--muted)]">{common("loading")}</p>
  }

  if (mode === "edit" && (error || !data)) {
    return (
      <GlassCard padding="default" hover="none">
        <p className="text-sm text-rose-300">{t("feedback.loadFailed")}</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-5">
      <GlassCard padding="default" hover="none" className="overflow-hidden">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge
                text={t(`mode.${mode}`)}
                tone={mode === "create" ? "primary" : "info"}
              />
              <AdminStatusBadge
                text={t(`status.${summaryStatus}`)}
                tone={getStatusTone(summaryStatus)}
              />
              {capabilityOptions.map((capability) => (
                <span
                  key={capability}
                  className="rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-2 py-0.5 font-mono text-[10px] text-[var(--primary)]"
                >
                  {capability}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {mode === "create"
                  ? t("createTitle")
                  : name || slugValue || slug || t("title")}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
                {mode === "create" ? t("createDescription") : t("description")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/provider-presets">
                <ArrowLeft className="mr-2 size-4" />
                {common("back")}
              </Link>
            </Button>
            {mode === "edit" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-rose-300 hover:text-rose-200">
                    <Trash2 className="mr-2 size-4" />
                    {common("delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("deleteConfirm.description", {
                        name: name || slugValue || slug || "",
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{common("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isDeleting}
                      onClick={async (event) => {
                        event.preventDefault()
                        await handleDelete()
                      }}
                    >
                      {isDeleting ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      {common("delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : mode === "create" ? (
                <Plus className="mr-2 size-4" />
              ) : (
                <CheckCircle2 className="mr-2 size-4" />
              )}
              {mode === "create" ? t("actions.createAndOpen") : common("save")}
            </Button>
          </div>
        </div>
      </GlassCard>

      {feedback ? (
        <GlassCard padding="default" hover="none">
          <p
            className={
              feedbackTone === "error"
                ? "text-sm text-rose-300"
                : "text-sm text-emerald-300"
            }
          >
            {feedback}
          </p>
        </GlassCard>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_400px]">
        <div className="space-y-5">
          <GlassCard padding="none" hover="none">
            <div className="border-b border-white/8 px-5 py-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                {t("sections.basic")}
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("sections.basicHint")}</p>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="preset-slug">{t("fields.slug")}</Label>
                <Input
                  id="preset-slug"
                  value={slugValue}
                  onChange={(event) => setSlugValue(event.target.value)}
                  readOnly={mode === "edit"}
                  className={mode === "edit" ? "font-mono" : "font-mono"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-name">{t("fields.name")}</Label>
                <Input id="preset-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-provider">{t("fields.provider")}</Label>
                <Input id="preset-provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-category">{t("fields.category")}</Label>
                <Input id="preset-category" value={category} onChange={(event) => setCategory(event.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="preset-base-url">{t("fields.baseUrl")}</Label>
                <Input id="preset-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-url-template">{t("fields.urlTemplate")}</Label>
                <Input id="preset-url-template" value={urlTemplate} onChange={(event) => setUrlTemplate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-icon">{t("fields.icon")}</Label>
                <Input id="preset-icon" value={icon} onChange={(event) => setIcon(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-theme-color">{t("fields.themeColor")}</Label>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex size-9 rounded-lg border border-white/10"
                    style={{ backgroundColor: themeColor || "#1E40AF" }}
                    aria-hidden="true"
                  />
                  <Input
                    id="preset-theme-color"
                    value={themeColor}
                    onChange={(event) => setThemeColor(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-version">{t("fields.version")}</Label>
                <Input id="preset-version" value={version} onChange={(event) => setVersion(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-schema-version">{t("fields.protocolSchemaVersion")}</Label>
                <Input
                  id="preset-schema-version"
                  value={protocolSchemaVersion}
                  onChange={(event) => setProtocolSchemaVersion(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.active")}</Label>
                <div className="flex h-10 items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3">
                  <span className="text-sm text-[var(--foreground)]">{t(`status.${summaryStatus}`)}</span>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="none" hover="none">
            <div className="border-b border-white/8 px-5 py-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                {t("sections.auth")}
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("sections.authHint")}</p>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>{t("fields.authType")}</Label>
                <Select value={authType} onValueChange={setAuthType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">api_key</SelectItem>
                    <SelectItem value="bearer">bearer</SelectItem>
                    <SelectItem value="none">none</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="preset-auth-config">{t("fields.authConfig")}</Label>
                  <Button size="sm" variant="ghost" onClick={handleFormatAuthJson}>
                    <FileJson2 className="mr-2 size-4" />
                    {t("actions.formatJson")}
                  </Button>
                </div>
                <Textarea
                  id="preset-auth-config"
                  value={authConfigText}
                  onChange={(event) => setAuthConfigText(event.target.value)}
                  className="min-h-44 font-mono text-xs"
                />
                {authConfigState.error ? (
                  <p className="text-xs text-rose-300">{authConfigState.error}</p>
                ) : (
                  <p className="text-xs text-[var(--muted)]">{t("authConfigHint")}</p>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="none" hover="none">
            <div className="border-b border-white/8 px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {t("sections.protocolProfiles")}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {t("sections.protocolProfilesHint")}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={handleFormatProfilesJson}>
                  <FileJson2 className="mr-2 size-4" />
                  {t("actions.formatJson")}
                </Button>
              </div>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-wrap gap-2">
                {capabilityOptions.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-2 py-1 font-mono text-[10px] text-[var(--primary)]"
                  >
                    {capability}
                  </span>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="preset-protocol-profiles">{t("fields.protocolProfiles")}</Label>
                <Textarea
                  id="preset-protocol-profiles"
                  value={protocolProfilesText}
                  onChange={(event) => setProtocolProfilesText(event.target.value)}
                  className="min-h-[28rem] font-mono text-xs"
                />
                {protocolProfilesState.error ? (
                  <p className="text-xs text-rose-300">{protocolProfilesState.error}</p>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    {t("fields.protocolProfilesHelp", {
                      capabilities: capabilityOptions.join(", "),
                    })}
                  </p>
                )}
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 self-start">
          <GlassCard padding="default" hover="none">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  {t("sections.summary")}
                </h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{t("sections.summaryHint")}</p>
              </div>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="text-xs text-[var(--muted)]">{t("summary.name")}</div>
                  <div className="mt-1 text-base font-semibold text-[var(--foreground)]">
                    {name || "—"}
                  </div>
                  <div className="mt-1 font-mono text-xs text-[var(--muted)]">{slugValue || "—"}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="text-xs text-[var(--muted)]">{t("summary.provider")}</div>
                    <div className="mt-1 text-sm text-[var(--foreground)]">{provider || "—"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="text-xs text-[var(--muted)]">{t("summary.updated")}</div>
                    <div className="mt-1 text-sm text-[var(--foreground)]">
                      {mode === "edit" ? formatDate(data?.updated_at) : t("summary.notSaved")}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="text-xs text-[var(--muted)]">{t("summary.endpoint")}</div>
                  <div className="mt-1 break-all font-mono text-xs text-[var(--foreground)]">
                    {baseUrl || "—"}
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="default" hover="none">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Radar className="size-4 text-[var(--primary)]" />
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      {t("sections.verify")}
                    </h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{t("sections.verifyHint")}</p>
                </div>
                <Button onClick={() => void handleVerify()} disabled={isVerifying}>
                  {isVerifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
                  {t("actions.verify")}
                </Button>
              </div>

              {mode === "create" ? (
                <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-4 text-sm text-[var(--muted)]">
                  {t("verify.feedback.saveFirst")}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>{t("verify.fields.capability")}</Label>
                    <Select value={verifyCapability} onValueChange={setVerifyCapability}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {capabilityOptions.map((capability) => (
                          <SelectItem key={capability} value={capability}>
                            {capability}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verify-model">{t("verify.fields.model")}</Label>
                    <Input
                      id="verify-model"
                      value={verifyModel}
                      onChange={(event) => setVerifyModel(event.target.value)}
                      placeholder={t("verify.placeholders.model")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verify-api-key">{t("verify.fields.apiKey")}</Label>
                    <Input
                      id="verify-api-key"
                      type="password"
                      value={verifyApiKey}
                      onChange={(event) => setVerifyApiKey(event.target.value)}
                      placeholder={t("verify.placeholders.apiKey")}
                    />
                    <p className="text-xs text-[var(--muted)]">{t("verify.apiKeyHint")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verify-prompt">{t("verify.fields.prompt")}</Label>
                    <Textarea
                      id="verify-prompt"
                      value={verifyPrompt}
                      onChange={(event) => setVerifyPrompt(event.target.value)}
                      className="min-h-24"
                    />
                  </div>
                </>
              )}

              {verifyError ? <p className="text-sm text-rose-300">{verifyError}</p> : null}

              {verifyResult ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                    <CheckCircle2 className="size-4 text-emerald-300" />
                    {t("verify.result.response", {
                      status: `${verifyResult.status} (${verifyResult.status_code})`,
                    })}
                  </div>
                  <Textarea
                    readOnly
                    value={verifyResult.response_preview || ""}
                    className="min-h-40 font-mono text-xs"
                  />
                </div>
              ) : null}
            </div>
          </GlassCard>

          <GlassCard padding="default" hover="none">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  {t("sections.preview")}
                </h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{t("sections.previewHint")}</p>
              </div>
              <Textarea readOnly value={previewJson} className="min-h-[22rem] font-mono text-xs" />
              {verifyResult ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--foreground)]">
                    {t("verify.result.request")}
                  </div>
                  <Textarea
                    readOnly
                    value={prettyJson(verifyResult.rendered_request)}
                    className="min-h-48 font-mono text-xs"
                  />
                </div>
              ) : null}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  )
}
