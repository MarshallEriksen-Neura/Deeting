"use client"

import * as React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { Cloud, Monitor, ShieldCheck, User, Lock, Download } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/hooks/use-i18n"
import { useChatService } from "@/hooks/use-chat-service"
import { useUserProfile } from "@/hooks/use-user"
import { Container } from "@/components/ui/container"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { updateEmbeddingSetting } from "@/lib/api/settings"
import { updateUserSecretary, type UserSecretaryUpdate } from "@/lib/api/secretary"
import {
  useSystemEmbeddingSetting,
  useUserSecretary,
} from "@/lib/swr/use-embedding-settings"

const EMBEDDING_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
]

interface SettingsFormValues {
  cloudModel: string
  desktopModel: string
  secretaryModel: string
  topicNamingModel: string
}

export function SettingsPageClient() {
  const t = useI18n("settings")
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const { profile, isLoading: isLoadingProfile, isAuthenticated } = useUserProfile()
  const {
    data: systemSetting,
    isLoading: isLoadingSystem,
    mutate: mutateSystem,
  } = useSystemEmbeddingSetting({ enabled: isAuthenticated })
  const {
    data: secretarySetting,
    isLoading: isLoadingSecretary,
    mutate: mutateSecretary,
  } = useUserSecretary({ enabled: isAuthenticated })
  const { modelGroups, isLoadingModels } = useChatService({ enabled: isAuthenticated })
  const [isSaving, setIsSaving] = React.useState(false)

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      cloudModel: EMBEDDING_MODELS[0],
      desktopModel: EMBEDDING_MODELS[1] ?? EMBEDDING_MODELS[0],
      secretaryModel: "",
      topicNamingModel: "",
    },
  })

  const isAdmin = Boolean(profile?.is_superuser)
  const canEditCloud = isAuthenticated && isAdmin
  const canEditDesktop = isAuthenticated && isTauri
  const canEditPersonal = isAuthenticated
  const canSave = isAuthenticated && (canEditCloud || canEditDesktop || canEditPersonal)
  const roleLabel = !isAuthenticated
    ? t("role.guest")
    : isAdmin
    ? t("role.admin")
    : t("role.user")
  const isLoading =
    isLoadingProfile || isLoadingSystem || isLoadingSecretary || isLoadingModels
  const hasAvailableModels = modelGroups.length > 0

  React.useEffect(() => {
    if (!isAuthenticated) return
    if (isLoadingSystem || isLoadingSecretary) return
    form.reset({
      cloudModel: systemSetting?.model_name ?? EMBEDDING_MODELS[0],
      desktopModel: secretarySetting?.embedding_model ?? EMBEDDING_MODELS[0],
      secretaryModel: secretarySetting?.model_name ?? "",
      topicNamingModel: secretarySetting?.topic_naming_model ?? "",
    })
  }, [
    form,
    isAuthenticated,
    isLoadingSystem,
    isLoadingSecretary,
    systemSetting?.model_name,
    secretarySetting?.embedding_model,
    secretarySetting?.model_name,
    secretarySetting?.topic_naming_model,
  ])

  async function onSubmit(values: SettingsFormValues) {
    if (!isAuthenticated) {
      toast.error(t("toast.unauthenticated"))
      return
    }
    if (!canSave) {
      toast.error(t("toast.noPermission"))
      return
    }
    setIsSaving(true)
    try {
      const tasks: Promise<unknown>[] = []
      if (canEditCloud) {
        tasks.push(updateEmbeddingSetting({ model_name: values.cloudModel }))
      }
      const secretaryPayload: UserSecretaryUpdate = {}
      if (canEditDesktop && values.desktopModel?.trim()) {
        secretaryPayload.embedding_model = values.desktopModel.trim()
      }
      if (canEditPersonal && values.secretaryModel?.trim()) {
        secretaryPayload.model_name = values.secretaryModel.trim()
      }
      if (canEditPersonal && values.topicNamingModel?.trim()) {
        secretaryPayload.topic_naming_model = values.topicNamingModel.trim()
      }
      if (Object.keys(secretaryPayload).length > 0) {
        tasks.push(updateUserSecretary(secretaryPayload))
      }
      await Promise.all(tasks)
      await Promise.all([mutateSystem?.(), mutateSecretary?.()])
      toast.success(t("toast.saveSuccess"))
    } catch (error) {
      toast.error(t("toast.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <GlassCard
        blur="sm"
        theme="surface"
        hover="none"
        padding="lg"
        className="mb-6 border border-white/40 bg-white/80 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]"
      >
        <GlassCardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <GlassCardTitle className="text-2xl font-semibold text-slate-900">
                {t("title")}
              </GlassCardTitle>
              <GlassCardDescription className="text-sm text-slate-600">
                {t("subtitle")}
              </GlassCardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t("env.currentLabel")}</span>
              <Badge
                variant="secondary"
                className="gap-1 bg-slate-100 text-slate-700"
              >
                {isTauri ? <Monitor className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                {isTauri ? t("env.desktop") : t("env.web")}
              </Badge>
            </div>
          </div>
        </GlassCardHeader>
        <GlassCardContent className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{t("role.currentLabel")}</span>
            <Badge
              variant="secondary"
              className="gap-1 bg-slate-100 text-slate-700"
            >
              {isAdmin ? (
                <ShieldCheck className="h-3 w-3" />
              ) : (
                <User className="h-3 w-3" />
              )}
              {roleLabel}
            </Badge>
            {isLoading && <span>{t("role.loading")}</span>}
          </div>
        </GlassCardContent>
      </GlassCard>

      {!isAuthenticated && (
        <Alert className="mb-6 border-0 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-500" />
          <AlertTitle className="text-slate-800">
            {t("auth.requiredTitle")}
          </AlertTitle>
          <AlertDescription className="text-slate-600">
            <p>{t("auth.requiredDesc")}</p>
          </AlertDescription>
        </Alert>
      )}

      <Alert className="mb-6 border-0 bg-white/90 shadow-[0_4px_20px_-12px_rgba(37,99,235,0.2)]">
        <Cloud className="h-4 w-4 text-blue-500" />
        <AlertTitle className="text-slate-900">
          {t("alert.consistencyTitle")}
        </AlertTitle>
        <AlertDescription className="text-slate-600">
          <p>{t("alert.consistencyDesc")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>{t("alert.dimensionHint")}</span>
            <span>{t("alert.versionHint")}</span>
          </div>
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02),0_10px_15px_-3px_rgba(0,0,0,0.04)]">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg text-slate-900">
                      {t("cloud.title")}
                    </CardTitle>
                    <CardDescription className="text-slate-600">
                      {t("cloud.description")}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <Cloud className="h-3 w-3" />
                    {t("env.cloud")}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {canEditCloud ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                  ) : (
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span>
                    {canEditCloud ? t("cloud.editableHint") : t("cloud.readonlyHint")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="cloudModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("cloud.modelLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={!canEditCloud}
                      >
                        <FormControl>
                          <SelectTrigger disabled={!canEditCloud}>
                            <SelectValue placeholder={t("cloud.modelPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMBEDDING_MODELS.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("cloud.modelHelp")}</FormDescription>
                    </FormItem>
                  )}
                />
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  <div className="flex items-center justify-between">
                    <span>{t("cloud.scopeLabel")}</span>
                    <span className="text-slate-700">{t("cloud.scopeValue")}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Badge variant="outline" className="text-xs">
                  {t("cloud.scopeBadge")}
                </Badge>
              </CardFooter>
            </Card>

            <Card className="border-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02),0_10px_15px_-3px_rgba(0,0,0,0.04)]">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg text-slate-900">
                      {t("desktop.title")}
                    </CardTitle>
                    <CardDescription className="text-slate-600">
                      {t("desktop.description")}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <Monitor className="h-3 w-3" />
                    {t("env.desktop")}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {canEditDesktop ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                  ) : (
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span>
                    {canEditDesktop
                      ? t("desktop.editableHint")
                      : t("desktop.readonlyHint")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="desktopModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("desktop.modelLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={!canEditDesktop}
                      >
                        <FormControl>
                          <SelectTrigger disabled={!canEditDesktop}>
                            <SelectValue placeholder={t("desktop.modelPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMBEDDING_MODELS.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("desktop.modelHelp")}</FormDescription>
                    </FormItem>
                  )}
                />
                {!isTauri && (
                  <Alert className="border-0 bg-slate-50">
                    <Download className="h-4 w-4 text-slate-500" />
                    <AlertTitle className="text-slate-800">
                      {t("desktop.unavailableTitle")}
                    </AlertTitle>
                    <AlertDescription className="text-slate-600">
                      <p>{t("desktop.unavailableDesc")}</p>
                      <div className="mt-3">
                        <Button asChild variant="outline" size="sm">
                          <Link href="/market">{t("desktop.download")}</Link>
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
              <CardFooter className="justify-end">
                <Badge variant="outline" className="text-xs">
                  {t("desktop.scopeBadge")}
                </Badge>
              </CardFooter>
            </Card>

            <Card className="border-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02),0_10px_15px_-3px_rgba(0,0,0,0.04)]">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg text-slate-900">
                      {t("personal.title")}
                    </CardTitle>
                    <CardDescription className="text-slate-600">
                      {t("personal.description")}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <User className="h-3 w-3" />
                    {t("personal.badge")}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {canEditPersonal ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                  ) : (
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span>
                    {canEditPersonal
                      ? t("personal.editableHint")
                      : t("personal.readonlyHint")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="topicNamingModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("personal.topicLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={!canEditPersonal || !hasAvailableModels}
                      >
                        <FormControl>
                          <SelectTrigger disabled={!canEditPersonal || !hasAvailableModels}>
                            <SelectValue placeholder={t("personal.topicPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {hasAvailableModels ? (
                            modelGroups.map((group) => (
                              <SelectGroup key={group.instance_id}>
                                <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                  {group.instance_name}
                                </SelectLabel>
                                {group.models.map((model) => (
                                  <SelectItem key={`${group.instance_id}-${model.id}`} value={model.id}>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-medium text-foreground">{model.id}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {group.provider || model.owned_by || "provider"}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))
                          ) : (
                            <SelectItem value="empty" disabled>
                              {t("personal.emptyHint")}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("personal.topicHelp")}</FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secretaryModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("personal.secretaryLabel")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={!canEditPersonal || !hasAvailableModels}
                      >
                        <FormControl>
                          <SelectTrigger disabled={!canEditPersonal || !hasAvailableModels}>
                            <SelectValue placeholder={t("personal.secretaryPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {hasAvailableModels ? (
                            modelGroups.map((group) => (
                              <SelectGroup key={group.instance_id}>
                                <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                  {group.instance_name}
                                </SelectLabel>
                                {group.models.map((model) => (
                                  <SelectItem key={`${group.instance_id}-${model.id}`} value={model.id}>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-medium text-foreground">{model.id}</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {group.provider || model.owned_by || "provider"}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))
                          ) : (
                            <SelectItem value="empty" disabled>
                              {t("personal.emptyHint")}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("personal.secretaryHelp")}</FormDescription>
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="justify-end">
                <Badge variant="outline" className="text-xs">
                  {t("personal.scopeBadge")}
                </Badge>
              </CardFooter>
            </Card>
          </div>

          <Separator className="bg-slate-100" />

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-slate-500">{t("actions.hint")}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset()}
                disabled={isSaving}
              >
                {t("actions.reset")}
              </Button>
              <Button
                type="submit"
                disabled={!canSave || isSaving || form.formState.isSubmitting}
              >
                {isSaving ? t("actions.saving") : t("actions.save")}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </Container>
  )
}
