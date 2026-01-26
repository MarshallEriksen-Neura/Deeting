"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Form } from "@/components/ui/form"
import { useI18n } from "@/hooks/use-i18n"
import { useChatService } from "@/hooks/use-chat-service"
import { updateEmbeddingSetting } from "@/lib/api/settings"
import { updateUserSecretary, type UserSecretaryUpdate } from "@/lib/api/secretary"
import {
  useSystemEmbeddingSetting,
  useUserSecretary,
} from "@/lib/swr/use-embedding-settings"
import { CloudSettingsCard } from "./cloud-settings-card"
import { PersonalSettingsCard } from "./personal-settings-card"
import { SettingsFormActions } from "./settings-form-actions"
import { type SettingsFormValues } from "../types"

interface SettingsFormProps {
  isAuthenticated: boolean
  isAdmin: boolean
}

export function SettingsForm({ isAuthenticated, isAdmin }: SettingsFormProps) {
  const t = useI18n("settings")
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
  
  // Fetch chat models for personal settings
  const { modelGroups: chatModelGroups, isLoadingModels: isLoadingChatModels } = useChatService({
    enabled: isAuthenticated,
    modelCapability: "chat",
  })

  // Fetch embedding models for cloud settings
  const { modelGroups: embeddingModelGroups, isLoadingModels: isLoadingEmbeddingModels } = useChatService({
    enabled: isAuthenticated && isAdmin,
    modelCapability: "embedding",
  })

  const [isSaving, setIsSaving] = React.useState(false)

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      cloudModel: "",
      secretaryModel: "",
    },
  })

  const canEditCloud = isAuthenticated && isAdmin
  const canEditPersonal = isAuthenticated
  const canSave = isAuthenticated && (canEditCloud || canEditPersonal)
  const hasAvailableModels = chatModelGroups.length > 0

  React.useEffect(() => {
    if (!isAuthenticated) return
    if (isLoadingSystem || isLoadingSecretary) return
    form.reset({
      cloudModel: systemSetting?.model_name ?? "",
      secretaryModel: secretarySetting?.model_name ?? "",
    })
  }, [
    form,
    isAuthenticated,
    isLoadingSystem,
    isLoadingSecretary,
    systemSetting?.model_name,
    secretarySetting?.model_name,
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
      if (canEditCloud && values.cloudModel?.trim()) {
        tasks.push(updateEmbeddingSetting({ model_name: values.cloudModel.trim() }))
      }
      const secretaryPayload: UserSecretaryUpdate = {}
      if (canEditPersonal && values.secretaryModel?.trim()) {
        secretaryPayload.model_name = values.secretaryModel.trim()
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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className={isAdmin ? "grid gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
          {isAdmin && (
            <CloudSettingsCard
              control={form.control}
              canEditCloud={canEditCloud}
              modelGroups={embeddingModelGroups}
              isLoadingModels={isLoadingEmbeddingModels}
            />
          )}
          <PersonalSettingsCard
            control={form.control}
            canEditPersonal={canEditPersonal}
            hasAvailableModels={hasAvailableModels}
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
