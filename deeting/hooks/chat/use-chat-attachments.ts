"use client"

import { useCallback, useState } from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import { buildImageAttachments, UPLOAD_ERROR_CODES } from "@/lib/chat/attachments"
import { useI18n } from "@/hooks/use-i18n"
import type { ChatImageAttachment } from "@/lib/chat/message-content"

export function useChatAttachments() {
  const t = useI18n("chat")
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  
  const {
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
  } = useChatStateStore()

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    
    setAttachmentError(null)
    const result = await buildImageAttachments(files)
    
    if (result.skipped > 0 && result.attachments.length === 0) {
      setAttachmentError(t("input.image.errorInvalid"))
      return
    }
    
    if (result.attachments.length) {
      addAttachments(result.attachments)
    }
    
    if (result.rejected > 0) {
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      )
      setAttachmentError(
        hasUploadError ? t("input.image.errorUpload") : t("input.image.errorRead")
      )
    }
  }, [addAttachments, t])

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