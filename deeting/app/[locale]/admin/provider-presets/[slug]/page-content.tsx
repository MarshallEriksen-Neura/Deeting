"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
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
  fetchAdminProviderPreset,
  updateAdminProviderPreset,
  verifyAdminProviderPreset,
  type ProviderPresetItem,
  type ProviderPresetVerifyResponse,
} from "@/lib/api/admin-dashboard"

type PageContentProps = {
  slug: string
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

function hydrateForm(
  preset: ProviderPresetItem,
  setters: {
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

export function PageContent({ slug }: PageContentProps) {
  const t = useTranslations("admin.providerPresetsEditor")
  const common = useTranslations("admin.common")
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(["/api/v1/admin/provider-presets/detail", slug], () =>
    fetchAdminProviderPreset(slug)
  )

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
  const [hydratedSlug, setHydratedSlug] = useState<string | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [verifyCapability, setVerifyCapability] = useState("chat")
  const [verifyModel, setVerifyModel] = useState("")
  const [verifyPrompt, setVerifyPrompt] = useState("ping")
  const [verifyApiKey, setVerifyApiKey] = useState("")
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<ProviderPresetVerifyResponse | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    if (!data || hydratedSlug === data.slug) return
    hydrateForm(data, {
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
    })
    setHydratedSlug(data.slug ?? slug)
  }, [data, hydratedSlug, slug])

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

  async function handleSave() {
    setSaveFeedback(null)
    setSaveError(null)
    if (!name.trim() || !provider.trim() || !baseUrl.trim()) {
      setSaveError(t("feedback.requiredFields"))
      return
    }
    if (authConfigState.error || protocolProfilesState.error) {
      setSaveError(t("feedback.invalidJson"))
      return
    }
    const numericVersion = Number(version)
    if (!Number.isInteger(numericVersion) || numericVersion < 1) {
      setSaveError(t("feedback.invalidVersion"))
      return
    }

    setIsSaving(true)
    try {
      const updated = await updateAdminProviderPreset(slug, {
        name: name.trim(),
        provider: provider.trim(),
        category: emptyToNull(category),
        base_url: baseUrl.trim(),
        url_template: emptyToNull(urlTemplate),
        theme_color: emptyToNull(themeColor),
        icon: emptyToNull(icon),
        auth_type: authType,
        auth_config: authConfigState.value ?? {},
        protocol_schema_version: emptyToNull(protocolSchemaVersion),
        protocol_profiles: protocolProfilesState.value ?? {},
        version: numericVersion,
        is_active: isActive,
      })
      await mutate(updated, false)
      hydrateForm(updated, {
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
      })
      setSaveFeedback(t("feedback.saved"))
    } catch (updateError) {
      setSaveError(
        updateError instanceof Error ? updateError.message : t("feedback.saveFailed")
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleVerify() {
    setVerifyError(null)
    setVerifyResult(null)
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
      const result = await verifyAdminProviderPreset(slug, {
        capability: verifyCapability,
        api_key: verifyApiKey.trim(),
        model: verifyModel.trim(),
        prompt: verifyPrompt.trim() || "ping",
        preset_override: {
          provider: provider.trim(),
          base_url: baseUrl.trim(),
          auth_type: authType,
          auth_config: authConfigState.value ?? {},
          protocol_schema_version: emptyToNull(protocolSchemaVersion) ?? undefined,
          protocol_profiles: protocolProfilesState.value ?? {},
        },
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

  if (isLoading) {
    return <p className="text-sm text-[var(--muted)]">{common("loading")}</p>
  }

  if (error || !data) {
    return (
      <GlassCard padding="default" hover="none">
        <p className="text-sm text-rose-300">{t("feedback.loadFailed")}</p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--foreground)]">
            {data.name || data.slug || slug}
          </h2>
          <p className="font-mono text-xs text-[var(--muted)]">{data.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/provider-presets">
              <ArrowLeft className="mr-2 size-4" />
              {common("back")}
            </Link>
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {common("save")}
          </Button>
        </div>
      </div>

      {(saveFeedback || saveError) && (
        <GlassCard padding="default" hover="none">
          <p className={`text-sm ${saveError ? "text-rose-300" : "text-emerald-300"}`}>
            {saveError || saveFeedback}
          </p>
        </GlassCard>
      )}

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">{t("sections.basic")}</h3>
            <p className="text-xs text-[var(--muted)]">{t("sections.basicHint")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span>{t("fields.active")}</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="preset-slug">{t("fields.slug")}</Label>
            <Input id="preset-slug" value={data.slug ?? slug} readOnly />
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
            <Input id="preset-theme-color" value={themeColor} onChange={(event) => setThemeColor(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset-version">{t("fields.version")}</Label>
            <Input id="preset-version" value={version} onChange={(event) => setVersion(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="preset-schema-version">{t("fields.protocolSchemaVersion")}</Label>
            <Input
              id="preset-schema-version"
              value={protocolSchemaVersion}
              onChange={(event) => setProtocolSchemaVersion(event.target.value)}
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard padding="default" hover="none">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{t("sections.auth")}</h3>
          <p className="text-xs text-[var(--muted)]">{t("sections.authHint")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
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
            <Label htmlFor="preset-auth-config">{t("fields.authConfig")}</Label>
            <Textarea
              id="preset-auth-config"
              value={authConfigText}
              onChange={(event) => setAuthConfigText(event.target.value)}
              className="min-h-44 font-mono text-xs"
            />
            {authConfigState.error && (
              <p className="text-xs text-rose-300">{authConfigState.error}</p>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard padding="default" hover="none">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{t("sections.protocolProfiles")}</h3>
          <p className="text-xs text-[var(--muted)]">{t("sections.protocolProfilesHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="preset-protocol-profiles">{t("fields.protocolProfiles")}</Label>
          <Textarea
            id="preset-protocol-profiles"
            value={protocolProfilesText}
            onChange={(event) => setProtocolProfilesText(event.target.value)}
            className="min-h-80 font-mono text-xs"
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
      </GlassCard>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-300" />
              <h3 className="text-base font-semibold text-[var(--foreground)]">{t("sections.verify")}</h3>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("sections.verifyHint")}</p>
          </div>
          <Button onClick={() => void handleVerify()} disabled={isVerifying}>
            {isVerifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t("actions.verify")}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="space-y-2 md:col-span-2">
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
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="verify-prompt">{t("verify.fields.prompt")}</Label>
            <Textarea
              id="verify-prompt"
              value={verifyPrompt}
              onChange={(event) => setVerifyPrompt(event.target.value)}
              className="min-h-24"
            />
          </div>
        </div>

        {verifyError && <p className="mt-3 text-sm text-rose-300">{verifyError}</p>}

        {verifyResult && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                <CheckCircle2 className="size-4 text-emerald-300" />
                {t("verify.result.request")}
              </div>
              <Textarea
                readOnly
                value={prettyJson(verifyResult.rendered_request)}
                className="min-h-72 font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-[var(--foreground)]">
                {t("verify.result.response", {
                  status: `${verifyResult.status} (${verifyResult.status_code})`,
                })}
              </div>
              <Textarea
                readOnly
                value={verifyResult.response_preview || ""}
                className="min-h-72 font-mono text-xs"
              />
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
