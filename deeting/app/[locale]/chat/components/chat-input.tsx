"use client"

import * as React from "react"
import Image from "next/image"
import { ImagePlus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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
  streamEnabled: boolean
  onStreamChange: (enabled: boolean) => void
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
  onClearAttachments,
  streamEnabled,
  onStreamChange
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
    <div className="safe-bottom p-3 sm:p-4 border-t border-slate-200/70 dark:border-white/10 bg-white/90 dark:bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="max-w-5xl 2xl:max-w-6xl mx-auto space-y-3">
        {attachments.length ? (
          <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-slate-50/80 dark:bg-muted/30 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-slate-600 dark:text-muted-foreground">
                {t("input.image.summary", { count: attachments.length })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8 min-w-[44px] hover:bg-slate-200/70 dark:hover:bg-white/10"
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
                  className="group relative overflow-hidden rounded-xl bg-white dark:bg-background/60 shadow-sm border border-slate-200/70 dark:border-white/10"
                >
                  <Image
                    src={attachment.url ?? ""}
                    alt={attachment.name ?? t("input.image.alt")}
                    width={240}
                    height={240}
                    className="h-28 w-full object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2 py-1.5 text-[10px] text-white backdrop-blur-sm">
                    <span className="truncate">
                      {attachment.name ?? t("input.image.alt")}
                    </span>
                    {typeof attachment.size === "number" ? (
                      <span className="shrink-0">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 min-h-[44px] min-w-[44px] h-8 w-8 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 transition-all group-hover:opacity-100 sm:h-7 sm:w-7 sm:min-h-0 sm:min-w-0"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    aria-label={t("input.image.remove")}
                    disabled={disabled}
                  >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        <div className="relative flex items-end gap-3">
          <div className="flex items-center justify-center bg-slate-100 dark:bg-white/5 rounded-full p-1 h-11 border border-slate-200/70 dark:border-white/10">
             <div className="flex items-center gap-2 px-2">
                <Switch
                  id="stream-mode"
                  checked={streamEnabled}
                  onCheckedChange={onStreamChange}
                  disabled={disabled}
                  className="scale-75 data-[state=checked]:bg-blue-500"
                />
                <label 
                  htmlFor="stream-mode" 
                  className={cn(
                    "text-[10px] font-medium cursor-pointer select-none hidden sm:block uppercase tracking-wider",
                    streamEnabled ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-muted-foreground"
                  )}
                >
                  {streamEnabled ? "Stream" : "Batch"}
                </label>
             </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 min-h-[44px] min-w-[44px] h-11 w-11 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("input.image.add")}
            disabled={disabled}
          >
            <ImagePlus className="h-5 w-5 text-slate-600 dark:text-white/70" />
          </Button>
          
          <div className="relative flex-1 flex items-end gap-2 rounded-2xl border border-slate-200/70 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-2 shadow-sm transition-all focus-within:ring-2 focus-within:ring-slate-300 dark:focus-within:ring-white/20">
            <Input
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t("input.placeholder", { name: placeholderName })}
              className="flex-1 bg-transparent border-0 shadow-none text-slate-800 dark:text-white placeholder:text-slate-500 dark:placeholder:text-white/40 text-[15px] h-auto min-h-[44px] py-2.5 px-3 focus-visible:ring-0 focus-visible:outline-none"
              autoFocus
              disabled={disabled}
            />
            <Button
              size="icon"
              className="shrink-0 min-h-[44px] min-w-[44px] h-10 w-10 rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-white/10 dark:text-white dark:hover:bg-white dark:hover:text-black transition-all duration-200 active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              onClick={onSend}
              disabled={!hasContent || disabled}
              aria-label={t("controls.send")}
            >
              <Send className="w-5 h-5" />
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
          <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90 py-1">
            {attachmentError}
          </div>
        ) : null}

        {resolvedErrorMessage ? (
          <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90 py-1">
            {resolvedErrorMessage}
          </div>
        ) : null}

        <div className="text-center text-[11px] text-slate-500/70 dark:text-muted-foreground/50 leading-relaxed">
          {t("footer.disclaimer")}
        </div>
      </div>
    </div>
  )
}