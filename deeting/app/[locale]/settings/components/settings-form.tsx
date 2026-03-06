"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Form } from "@/components/ui/form"
import { Progress } from "@/components/ui/progress"
import { GlassButton } from "@/components/ui/glass-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useI18n } from "@/hooks/use-i18n"
import { useChatService } from "@/hooks/use-chat-service"
import {
  LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT,
  rebuildLocalEmbeddingAssets,
  type LocalEmbeddingRebuildProgressPayload,
  type LocalEmbeddingRebuildResponse,
} from "@/lib/api/local-embedding-rebuild"
import { updateUserSecretary, type UserSecretaryUpdate } from "@/lib/api/secretary"
import { updateUserEmbeddingConfig } from "@/lib/api/user-embedding-config"
import {
  useUserEmbeddingConfig,
  useUserSecretary,
} from "@/lib/swr/use-embedding-settings"
import { DesktopEmbeddingSettingsCard } from "./desktop-embedding-settings-card"
import { DesktopRelaySettingsCard } from "./desktop-relay-settings-card"
import { AgentSettingsCard } from "./agent-settings-card"
import { PersonalSettingsCard } from "./personal-settings-card"
import { SettingsFormActions } from "./settings-form-actions"
import { SettingsNav, type SettingsSection } from "./settings-nav"
import { type SettingsFormValues } from "../types"

interface SettingsFormProps {
  isAuthenticated: boolean
  isTauriRuntime: boolean
}

export function SettingsForm({ isAuthenticated, isTauriRuntime }: SettingsFormProps) {
  const t = useI18n("settings")
  const [activeSection, setActiveSection] = React.useState<SettingsSection>("models")
  const {
    data: secretarySetting,
    isLoading: isLoadingSecretary,
    mutate: mutateSecretary,
  } = useUserSecretary({ enabled: isAuthenticated })
  const {
    data: userEmbeddingConfig,
    isLoading: isLoadingUserEmbeddingConfig,
    mutate: mutateUserEmbeddingConfig,
  } = useUserEmbeddingConfig({ enabled: isAuthenticated && isTauriRuntime })

  // Fetch chat models for personal settings
  const { modelGroups: chatModelGroups, isLoadingModels: isLoadingChatModels } = useChatService({
    enabled: isAuthenticated,
    modelCapability: "chat",
  })
  const {
    modelGroups: embeddingModelGroups,
    isLoadingModels: isLoadingEmbeddingModels,
  } = useChatService({
    enabled: isAuthenticated,
    modelCapability: "embedding",
  })

  const [isSaving, setIsSaving] = React.useState(false)
  const [hasPendingRebuild, setHasPendingRebuild] = React.useState(false)
  const [isRebuildPromptOpen, setIsRebuildPromptOpen] = React.useState(false)
  const [isRebuilding, setIsRebuilding] = React.useState(false)
  const [rebuildProgress, setRebuildProgress] =
    React.useState<LocalEmbeddingRebuildProgressPayload | null>(null)
  const [rebuildSummary, setRebuildSummary] =
    React.useState<LocalEmbeddingRebuildResponse | null>(null)

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      secretaryModel: "",
      desktopEmbeddingProviderModelId: "",
      relayBaseUrl: "",
      relaySharedSecret: "",
    },
  })

  const canEditPersonal = isAuthenticated
  const canEditDesktop = isAuthenticated && isTauriRuntime
  const canSave = isAuthenticated
  const hasAvailableChatModels = chatModelGroups.length > 0
  const hasAvailableEmbeddingModels = embeddingModelGroups.length > 0

  React.useEffect(() => {
    if (!isAuthenticated) return
    if (isLoadingSecretary) return
    if (isTauriRuntime && isLoadingUserEmbeddingConfig) return
    let cancelled = false

    const syncSettings = async () => {
      let relayBaseUrl = ""
      let relaySharedSecret = ""

      if (isTauriRuntime) {
        try {
          const { getDesktopRelaySettings } = await import("@/lib/api/desktop-relay")
          const current = await getDesktopRelaySettings()
          if (!cancelled) {
            relayBaseUrl = current.relayBaseUrl ?? ""
            relaySharedSecret = current.relaySharedSecret ?? ""
          }
        } catch (error) {
          console.warn("[desktop-settings] load relay settings failed", error)
        }
      }

      if (cancelled) return

      form.reset({
        secretaryModel: secretarySetting?.model_name ?? "",
        desktopEmbeddingProviderModelId: isTauriRuntime
          ? userEmbeddingConfig?.provider_model_id ?? ""
          : "",
        relayBaseUrl,
        relaySharedSecret,
      })
    }

    void syncSettings()

    return () => {
      cancelled = true
    }
  }, [
    form,
    isAuthenticated,
    isLoadingSecretary,
    isLoadingUserEmbeddingConfig,
    isTauriRuntime,
    secretarySetting?.model_name,
    userEmbeddingConfig?.provider_model_id,
  ])

  const handleStartRebuild = React.useCallback(async () => {
    if (!isTauriRuntime || isRebuilding) return

    setIsRebuildPromptOpen(false)
    setIsRebuilding(true)
    setRebuildProgress({
      phase: "prepare",
      progress: 0,
      total: 0,
      processed: 0,
      indexed: 0,
      failed: 0,
      current: null,
    })

    let unlisten: (() => void) | null = null
    try {
      const { listen } = await import("@tauri-apps/api/event")
      unlisten = await listen<LocalEmbeddingRebuildProgressPayload>(
        LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT,
        (event) => {
          setRebuildProgress(event.payload)
        }
      )

      const summary = await rebuildLocalEmbeddingAssets()
      setRebuildSummary(summary)
      setHasPendingRebuild(false)
      toast.success(
        t("toast.rebuildSuccess", {
          indexed: summary.indexed,
          failed: summary.failed,
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.rebuildFailed")
      toast.error(message)
    } finally {
      if (unlisten) {
        unlisten()
      }
      setIsRebuilding(false)
    }
  }, [isRebuilding, isTauriRuntime, t])

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
      let desktopEmbeddingChanged = false
      let relaySettingsChanged = false

      if (canEditPersonal) {
        const secretaryPayload: UserSecretaryUpdate = {}
        const nextSecretaryModel = values.secretaryModel.trim()
        const currentSecretaryModel = secretarySetting?.model_name?.trim() ?? ""
        if (nextSecretaryModel !== currentSecretaryModel) {
          secretaryPayload.model_name = nextSecretaryModel || null
        }
        if (Object.keys(secretaryPayload).length > 0) {
          await updateUserSecretary(secretaryPayload)
        }
      }

      if (canEditDesktop) {
        const nextProviderModelId = values.desktopEmbeddingProviderModelId.trim()
        const currentProviderModelId = userEmbeddingConfig?.provider_model_id?.trim() ?? ""
        if (nextProviderModelId !== currentProviderModelId) {
          await updateUserEmbeddingConfig({
            provider_model_id: nextProviderModelId || null,
          })
          desktopEmbeddingChanged = true
        }

        // Desktop relay settings (only meaningful in Tauri runtime)
        if (isTauriRuntime) {
          const { getDesktopRelaySettings, updateDesktopRelaySettings } = await import(
            "@/lib/api/desktop-relay"
          )
          try {
            const current = await getDesktopRelaySettings()
            const nextBaseUrl = values.relayBaseUrl.trim()
            const nextSecret = values.relaySharedSecret.trim()
            if (
              nextBaseUrl !== (current.relayBaseUrl ?? "") ||
              nextSecret !== (current.relaySharedSecret ?? "")
            ) {
              await updateDesktopRelaySettings({
                relayBaseUrl: nextBaseUrl,
                relaySharedSecret: nextSecret,
              })
              relaySettingsChanged = true
            }
          } catch (error) {
            console.warn("[desktop-settings] update relay settings failed", error)
          }
        }
      }

      await mutateSecretary?.()
      if (canEditDesktop) {
        await mutateUserEmbeddingConfig?.()
      }
      toast.success(t("toast.saveSuccess"))
      if (desktopEmbeddingChanged) {
        setHasPendingRebuild(true)
        setRebuildSummary(null)
        setRebuildProgress(null)
        setIsRebuildPromptOpen(true)
        toast(t("toast.rebuildRecommended"))
      }

      if (relaySettingsChanged) {
        toast(t("toast.desktopRelayUpdated"))
      }
    } catch {
      toast.error(t("toast.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  const showRebuildBanner = canEditDesktop && (hasPendingRebuild || isRebuilding || rebuildSummary)

  return (
    <Form {...form}>
      <div className="flex flex-col gap-0 md:flex-row md:gap-6">
        <SettingsNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          isTauriRuntime={isTauriRuntime}
        />

        <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 flex-1 space-y-6">
          {/* Models section */}
          {activeSection === "models" && (
            <div className="flex flex-col gap-6">
              <DesktopEmbeddingSettingsCard
                control={form.control}
                isTauriRuntime={isTauriRuntime}
                canEditDesktop={canEditDesktop}
                hasAvailableModels={hasAvailableEmbeddingModels}
                modelGroups={embeddingModelGroups}
                isLoadingModels={isLoadingEmbeddingModels}
              />
              <PersonalSettingsCard
                control={form.control}
                canEditPersonal={canEditPersonal}
                hasAvailableModels={hasAvailableChatModels}
                modelGroups={chatModelGroups}
                isLoadingModels={isLoadingChatModels}
              />
              {showRebuildBanner && (
                <div className="rounded-2xl border border-amber-200/60 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                  <p className="text-sm font-semibold text-foreground">{t("desktop.rebuildTitle")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("desktop.rebuildDescription")}</p>

                  {isRebuilding && (
                    <div className="mt-4 space-y-2">
                      <Progress value={rebuildProgress?.progress ?? 0} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {t(`desktop.rebuildStage.${rebuildProgress?.phase ?? "prepare"}`)} ·{" "}
                        {rebuildProgress?.processed ?? 0}/{rebuildProgress?.total ?? 0}
                      </p>
                    </div>
                  )}

                  {!isRebuilding && hasPendingRebuild && (
                    <div className="mt-3">
                      <GlassButton size="sm" onClick={handleStartRebuild}>
                        {t("desktop.rebuildAction")}
                      </GlassButton>
                    </div>
                  )}

                  {!isRebuilding && rebuildSummary && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("desktop.rebuildCompleted", {
                        indexed: rebuildSummary.indexed,
                        failed: rebuildSummary.failed,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Agent section */}
          {activeSection === "agent" && (
            <div className="flex flex-col gap-6">
              <AgentSettingsCard isTauriRuntime={isTauriRuntime} />
            </div>
          )}

          {/* Relay section */}
          {activeSection === "relay" && (
            <div className="flex flex-col gap-6">
              <DesktopRelaySettingsCard
                control={form.control}
                isTauriRuntime={isTauriRuntime}
                canEditDesktop={canEditDesktop}
              />
            </div>
          )}

          {activeSection !== "agent" && (
            <SettingsFormActions
              canSave={canSave}
              isSaving={isSaving}
              isSubmitting={form.formState.isSubmitting}
              onReset={() => form.reset()}
            />
          )}
        </form>
      </div>

      <AlertDialog open={isRebuildPromptOpen} onOpenChange={setIsRebuildPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("desktop.rebuildTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("desktop.rebuildDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("desktop.rebuildLater")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartRebuild}>
              {t("desktop.rebuildAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  )
}
