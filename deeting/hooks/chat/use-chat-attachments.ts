"use client"

import { useCallback, useMemo, useState } from "react"
import { useChatStore } from "@/store/chat-store"
import {
  buildChatAttachments,
  UPLOAD_ERROR_CODES,
  ATTACHMENT_INVALID_ERROR_CODES,
} from "@/lib/chat/attachments"
import { useI18n } from "@/hooks/use-i18n"

export function useChatAttachments() {
  const t = useI18n("chat")
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const {
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    models,
    config,
  } = useChatStore()

  const selectedModel = useMemo(
    () =>
      models.find(
        (model) => model.provider_model_id === config.model || model.id === config.model
      ) ?? models[0],
    [models, config.model]
  )

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    
    setAttachmentError(null)
    const result = await buildChatAttachments(files, {
      model: selectedModel?.id,
      providerModelId: selectedModel?.provider_model_id ?? undefined,
    })
    
    if (result.attachments.length) {
      addAttachments(result.attachments)
    }
    
    if (result.rejected > 0) {
      const hasInvalidError = result.errors.some((error) =>
        ATTACHMENT_INVALID_ERROR_CODES.has(error)
      )
      if (hasInvalidError) {
        setAttachmentError(t("input.attachment.errorInvalid"))
        return
      }
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      )
      setAttachmentError(
        hasUploadError
          ? t("input.attachment.errorUpload")
          : t("input.attachment.errorRead")
      )
    }
  }, [addAttachments, t, selectedModel])

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items
    if (!items?.length) return
    
    const files = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[]
    
    if (files.length) {
      void handleFiles(files)
    }
  }, [handleFiles])

  const clearError = useCallback(() => {
    setAttachmentError(null)
  }, [])

  return {
    attachments,
    attachmentError,
    handleFiles,
    handlePaste,
    removeAttachment,
    clearAttachments,
    clearError,
  }
}
