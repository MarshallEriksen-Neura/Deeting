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
  Trash2,
} from "lucide-react"

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
import { Button } from "@/ui/shadcn/button"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import { Textarea } from "@/ui/shadcn/textarea"
import { Switch } from "@/ui/shadcn/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select"
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
} from "@/ui/shadcn/alert-dialog"
import {
  AdminPageShell,
  AdminPanel,
  AdminStatusPill,
} from "@/components/admin/admin-shell"

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
  const invalidObjectError = field + " must be a JSON object"
  const invalidJsonError = field + " is invalid JSON"
  if (!source.trim()) {
    return { value: {}, error: null as string | null }
  }
  try {
    const parsed = JSON.parse(source)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: invalidObjectError }
    }
    return { value: parsed as Record<string, unknown>, error: null as string | null }
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : invalidJsonError,
    }
  }
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

  const previewJson = useMemo(() => prettyJson(draftPayload), [draftPayload])

  function validateBeforeSave() {
    if (!slugValue.trim() || !name.trim() || !provider.trim() || !baseUrl.trim()) {
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
        const createdSlug = (created.slug ?? draftPayload.slug).trim()
        setFeedbackTone("success")
        setFeedback(t("feedback.created"))
        router.replace("/admin/provider-presets/edit?slug=" + encodeURIComponent(createdSlug))
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

  if (mode === "edit" && isLoading) {
    return (
      <AdminPageShell
        eyebrow={t("title")}
        title={t("title")}
        description={common("loading")}
      >
        <AdminPanel className="p-6 text-sm text-[var(--ink-3)]">{common("loading")}</AdminPanel>
      </AdminPageShell>
    )
  }

  if (mode === "edit" && (error || !data)) {
    return (
      <AdminPageShell
        eyebrow={t("title")}
        title={t("title")}
        description={t("feedback.loadFailed")}
      >
        <AdminPanel className="p-6 text-sm text-rose-500">{t("feedback.loadFailed")}</AdminPanel>
      </AdminPageShell>
    )
  }

  return (
    <AdminPageShell
      eyebrow={t("title")}
      title={mode === "create" ? t("createTitle") : name || slugValue || slug || t("title")}
      description={mode === "create" ? t("createDescription") : t("description")}
      actions={
        <>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/admin/provider-presets">
              <ArrowLeft className="mr-2 size-4" />
              {common("back")}
            </Link>
          </Button>
          {mode === "edit" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="rounded-full text-rose-500 hover:text-rose-500">
                  <Trash2 className="mr-2 size-4" />
                  {common("delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
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
                    onClick={(event) => {
                      event.preventDefault()
                      void handleDelete()
                    }}
                  >
                    {isDeleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {common("delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button onClick={() => void handleSave()} disabled={isSaving} className="rounded-full">
            {isSaving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : mode === "create" ? (
              <Plus className="mr-2 size-4" />
            ) : (
              <CheckCircle2 className="mr-2 size-4" />
            )}
            {mode === "create" ? t("actions.createAndOpen") : common("save")}
          </Button>
        </>
      }
    >
      {feedback ? (
        <AdminPanel className="p-4">
          <p className={feedbackTone === "error" ? "text-sm text-rose-500" : "text-sm text-emerald-600 dark:text-emerald-300"}>
            {feedback}
          </p>
        </AdminPanel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <div className="space-y-6">
          <AdminPanel>
            <div className="border-b border-[var(--hairline)] px-5 py-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                {t("sections.basic")}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-3)]">{t("sections.basicHint")}</p>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="preset-slug">{t("fields.slug")}</Label>
                <Input
                  id="preset-slug"
                  value={slugValue}
                  onChange={(event) => setSlugValue(event.target.value)}
                  readOnly={mode === "edit"}
                  className="font-mono"
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
                    className="inline-flex size-10 rounded-xl border border-[var(--hairline)]"
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
                <Label htmlFor="preset-auth-type">{t("fields.authType")}</Label>
                <Select value={authType} onValueChange={setAuthType}>
                  <SelectTrigger id="preset-auth-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">api_key</SelectItem>
                    <SelectItem value="bearer">bearer</SelectItem>
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="oauth">oauth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("fields.active")}</Label>
                <div className="flex h-10 items-center justify-between rounded-2xl border border-[var(--hairline)] bg-[var(--window-bg)] px-3">
                  <AdminStatusPill
                    active={isActive}
                    label={isActive ? t("status.active") : t("status.inactive")}
                  />
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              </div>
            </div>
          </AdminPanel>

          <AdminPanel>
            <div className="border-b border-[var(--hairline)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                    {t("sections.auth")}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-3)]">{t("sections.authHint")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => !authConfigState.error && setAuthConfigText(prettyJson(authConfigState.value))}>
                  <FileJson2 className="mr-2 size-4" />
                  {t("actions.formatJson")}
                </Button>
              </div>
            </div>
            <div className="space-y-2 px-5 py-5">
              <Label htmlFor="preset-auth-json">auth_config</Label>
              <Textarea
                id="preset-auth-json"
                value={authConfigText}
                onChange={(event) => setAuthConfigText(event.target.value)}
                className="min-h-[220px] font-mono text-xs"
              />
              {authConfigState.error ? <p className="text-xs text-rose-500">{authConfigState.error}</p> : null}
            </div>
          </AdminPanel>

          <AdminPanel>
            <div className="border-b border-[var(--hairline)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                    {t("sections.protocols")}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-3)]">{t("sections.protocolsHint")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => !protocolProfilesState.error && setProtocolProfilesText(prettyJson(protocolProfilesState.value))}>
                  <FileJson2 className="mr-2 size-4" />
                  {t("actions.formatJson")}
                </Button>
              </div>
            </div>
            <div className="space-y-2 px-5 py-5">
              <Label htmlFor="preset-profiles-json">protocol_profiles</Label>
              <Textarea
                id="preset-profiles-json"
                value={protocolProfilesText}
                onChange={(event) => setProtocolProfilesText(event.target.value)}
                className="min-h-[320px] font-mono text-xs"
              />
              {protocolProfilesState.error ? <p className="text-xs text-rose-500">{protocolProfilesState.error}</p> : null}
            </div>
          </AdminPanel>
        </div>

        <div className="space-y-6">
          <AdminPanel>
            <div className="border-b border-[var(--hairline)] px-5 py-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                {t("sections.summary")}
              </h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-3 py-1 text-[11px] font-medium text-[var(--ink-2)]">
                  {t(`mode.${mode}`)}
                </span>
                <AdminStatusPill
                  active={isActive}
                  label={isActive ? t("status.active") : t("status.inactive")}
                />
                {capabilityOptions.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-2.5 py-1 font-mono text-[10px] text-[var(--ink-2)]"
                  >
                    {capability}
                  </span>
                ))}
              </div>
              <div className="space-y-2 rounded-[24px] border border-[var(--hairline)] bg-[var(--window-bg)] p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">{t("sections.preview")}</div>
                <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-[var(--ink-2)]">
                  {previewJson}
                </pre>
              </div>
            </div>
          </AdminPanel>

          <AdminPanel>
            <div className="border-b border-[var(--hairline)] px-5 py-4">
              <div className="flex items-center gap-2">
                <Radar className="size-4 text-[var(--accent-strong)]" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
                  {t("verify.title")}
                </h2>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-3)]">{t("verify.description")}</p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <Label htmlFor="verify-capability">{t("verify.fields.capability")}</Label>
                <Select value={verifyCapability} onValueChange={setVerifyCapability}>
                  <SelectTrigger id="verify-capability">
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
                <Input id="verify-model" value={verifyModel} onChange={(event) => setVerifyModel(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="verify-api-key">{t("verify.fields.apiKey")}</Label>
                <Input id="verify-api-key" type="password" value={verifyApiKey} onChange={(event) => setVerifyApiKey(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="verify-prompt">{t("verify.fields.prompt")}</Label>
                <Textarea id="verify-prompt" value={verifyPrompt} onChange={(event) => setVerifyPrompt(event.target.value)} className="min-h-[96px]" />
              </div>
              <Button onClick={() => void handleVerify()} disabled={isVerifying} className="w-full rounded-full">
                {isVerifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Radar className="mr-2 size-4" />}
                {t("verify.actions.run")}
              </Button>
              {verifyError ? <p className="text-sm text-rose-500">{verifyError}</p> : null}
              {verifyResult ? (
                <div className="space-y-3 rounded-[24px] border border-[var(--hairline)] bg-[var(--window-bg)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-2)]">
                      {verifyResult.status}
                    </span>
                    <span className="text-xs text-[var(--ink-3)]">HTTP {verifyResult.status_code}</span>
                  </div>
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">response_preview</div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-[var(--ink-2)]">
                      {verifyResult.response_preview || "-"}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">rendered_request</div>
                    <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-[var(--ink-2)]">
                      {prettyJson(verifyResult.rendered_request)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          </AdminPanel>
        </div>
      </div>
    </AdminPageShell>
  )
}
