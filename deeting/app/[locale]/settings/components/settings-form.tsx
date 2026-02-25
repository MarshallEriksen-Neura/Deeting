"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Form } from "@/components/ui/form"
import { useI18n } from "@/hooks/use-i18n"
import { useChatService } from "@/hooks/use-chat-service"
import { updateUserSecretary, type UserSecretaryUpdate } from "@/lib/api/secretary"
import { useUserSecretary } from "@/lib/swr/use-embedding-settings"
import { PersonalSettingsCard } from "./personal-settings-card"
import { SettingsFormActions } from "./settings-form-actions"
import { type SettingsFormValues } from "../types"

interface SettingsFormProps {
  isAuthenticated: boolean
}

export function SettingsForm({ isAuthenticated }: SettingsFormProps) {
  const t = useI18n("settings")
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

  const [isSaving, setIsSaving] = React.useState(false)

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      secretaryModel: "",
    },
  })

  const canEditPersonal = isAuthenticated
  const canSave = isAuthenticated
  const hasAvailableModels = chatModelGroups.length > 0

  React.useEffect(() => {
    if (!isAuthenticated) return
    if (isLoadingSecretary) return
    form.reset({
      secretaryModel: secretarySetting?.model_name ?? "",
    })
  }, [
    form,
    isAuthenticated,
    isLoadingSecretary,
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
      const secretaryPayload: UserSecretaryUpdate = {}
      if (canEditPersonal && values.secretaryModel?.trim()) {
        secretaryPayload.model_name = values.secretaryModel.trim()
      }
      if (Object.keys(secretaryPayload).length > 0) {
        await updateUserSecretary(secretaryPayload)
      }
      await mutateSecretary?.()
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
        <div className="flex flex-col gap-6">
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
