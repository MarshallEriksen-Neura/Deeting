"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Form } from "@/components/ui/form"
import { useI18n } from "@/hooks/use-i18n"
import { useChatService } from "@/hooks/use-chat-service"
import { updateUserSecretary, type UserSecretaryUpdate } from "@/lib/api/secretary"
import { updateUserEmbeddingConfig } from "@/lib/api/user-embedding-config"
import {
  useUserEmbeddingConfig,
  useUserSecretary,
} from "@/lib/swr/use-embedding-settings"
import { DesktopEmbeddingSettingsCard } from "./desktop-embedding-settings-card"
import { PersonalSettingsCard } from "./personal-settings-card"
import { SettingsFormActions } from "./settings-form-actions"
import { type SettingsFormValues } from "../types"

interface SettingsFormProps {
  isAuthenticated: boolean
  isTauriRuntime: boolean
}

export function SettingsForm({ isAuthenticated, isTauriRuntime }: SettingsFormProps) {
  const t = useI18n("settings")
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

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      secretaryModel: "",
      desktopEmbeddingProviderModelId: "",
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

    form.reset({
      secretaryModel: secretarySetting?.model_name ?? "",
      desktopEmbeddingProviderModelId: isTauriRuntime
        ? userEmbeddingConfig?.provider_model_id ?? ""
        : "",
    })
  }, [
    form,
    isAuthenticated,
    isLoadingSecretary,
    isLoadingUserEmbeddingConfig,
    isTauriRuntime,
    secretarySetting?.model_name,
    userEmbeddingConfig?.provider_model_id,
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
        }
      }

      await mutateSecretary?.()
      if (canEditDesktop) {
        await mutateUserEmbeddingConfig?.()
      }
      toast.success(t("toast.saveSuccess"))
    } catch {
      toast.error(t("toast.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
        </div>

        <SettingsFormActions
          canSave={canSave}
          isSaving={isSaving}
          isSubmitting={form.formState.isSubmitting}
          onReset={() => form.reset()}
        />
      </form>
    </Form>
  )
}
