"use client"

import * as React from "react"
import Image from "next/image"
import { ImagePlus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { buildImageAttachments, UPLOAD_ERROR_CODES } from "@/lib/chat/attachments"

interface ChatInputProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  placeholderName: string
  errorMessage: string | null
  attachments: ChatImageAttachment[]
  onAddAttachments: (attachments: ChatImageAttachment[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onClearAttachments: () => void
}

export function ChatInput({
  inputValue,
  onInputChange,
  onSend,
  disabled,
  placeholderName,
  errorMessage,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onClearAttachments
}: ChatInputProps) {
  const t = useI18n("chat")
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null)
  const hasContent = Boolean(inputValue.trim() || attachments.length)
  const resolvedErrorMessage = React.useMemo(() => {
    if (!errorMessage) return null
    if (errorMessage.startsWith("i18n:")) {
      return t(errorMessage.slice("i18n:".length))
    }
    return errorMessage
  }, [errorMessage, t])

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setAttachmentError(null)
    const result = await buildImageAttachments(files)
    if (result.skipped > 0 && result.attachments.length === 0) {
      setAttachmentError(t("input.image.errorInvalid"))
      return
    }
    if (result.attachments.length) {
      onAddAttachments(result.attachments)
    }
    if (result.rejected > 0) {
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      )
      setAttachmentError(
        hasUploadError ? t("input.image.errorUpload") : t("input.image.errorRead")
      )
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return
    const items = event.clipboardData?.items
    if (!items?.length) return
    const files = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[]
    if (files.length) {
      void handleFiles(files)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : []
    if (files.length) {
      await handleFiles(files)
      event.target.value = ""
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (hasContent && !disabled) {
        onSend()
      }
    }
  }

  return (
    <div className="p-4 border-t bg-background/80 backdrop-blur">
      <div className="max-w-3xl mx-auto space-y-3">
        {attachments.length ? (
          <div className="rounded-2xl border border-white/10 bg-muted/30 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted-foreground">
                {t("input.image.summary", { count: attachments.length })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={onClearAttachments}
                disabled={disabled}
              >
                {t("input.image.clear")}
              </Button>
            </div>
            <div className={cn("grid gap-2", attachments.length > 3 ? "grid-cols-3" : "grid-cols-2")}>
              {attachments
                .filter((attachment) => attachment.url)
                .map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative overflow-hidden rounded-xl bg-background/60 shadow-inner"
                >
                  <Image
                    src={attachment.url ?? ""}
                    alt={attachment.name ?? t("input.image.alt")}
                    width={240}
                    height={240}
                    className="h-28 w-full object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/35 px-2 py-1 text-[10px] text-white/80">
                    <span className="truncate">
                      {attachment.name ?? t("input.image.alt")}
                    </span>
                    {typeof attachment.size === "number" ? (
                      <span>{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/40 text-white/80 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    aria-label={t("input.image.remove")}
                    disabled={disabled}
                  >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        <div className="relative flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("input.image.add")}
            disabled={disabled}
          >
            <ImagePlus className="h-5 w-5" />
          </Button>
          <div className="relative flex-1">
            <Input
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t("input.placeholder", { name: placeholderName })}
              className="rounded-full pl-4 pr-12 py-6 shadow-sm border-muted-foreground/20 focus-visible:ring-1"
              autoFocus
              disabled={disabled}
            />
            <Button
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-8 w-8"
              onClick={onSend}
              disabled={!hasContent || disabled}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={disabled}
          />
        </div>

        {attachmentError ? (
          <div className="text-center text-xs text-red-500/80">
            {attachmentError}
          </div>
        ) : null}

        {resolvedErrorMessage ? (
          <div className="text-center text-xs text-red-500/80">
            {resolvedErrorMessage}
          </div>
        ) : null}

        <div className="text-center text-xs text-muted-foreground/50">
          {t("input.image.hint")}
        </div>
        <div className="text-center text-xs text-muted-foreground/50">
          {t("footer.disclaimer")}
        </div>
      </div>
    </div>
  )
}
