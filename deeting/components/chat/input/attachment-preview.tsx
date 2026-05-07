"use client"

import * as React from "react"
import Image from "next/image"
import { FileText, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { useLazyImage } from "@/hooks/use-lazy-image"
import { formatFileSize } from "@/lib/utils/file"
import { ImageLightbox } from "@/ui/common/image-lightbox"
import type { ChatAttachment } from "@/lib/chat/message-content"

interface AttachmentPreviewProps {
  attachments: ChatAttachment[]
  variant?: "assistant" | "user"
  onRemove?: (id: string) => void
  onClear?: () => void
  disabled?: boolean
  className?: string
}

interface AttachmentItemProps {
  attachment: ChatAttachment
  variant: "assistant" | "user"
  onRemove?: (id: string) => void
  disabled?: boolean
}

const isFileAttachment = (attachment: ChatAttachment) =>
  attachment.kind === "file" || Boolean(attachment.fileId)

const ImageAttachmentItem = React.memo<AttachmentItemProps>(
  ({ attachment, variant, onRemove, disabled }) => {
    const t = useI18n("chat")
    const isUserVariant = variant === "user"

    const { imageSrc, isLoading, error, imgRef } = useLazyImage({
      src: attachment.url ?? "",
      rootMargin: "50px",
      threshold: 0.01,
    })

    if (!attachment.url) {
      return null
    }

    if (isUserVariant) {
      return (
        <div className="group relative h-16 w-16 shrink-0">
          <ImageLightbox
            src={attachment.url}
            alt={attachment.name ?? t("input.image.alt")}
          >
            <div className="h-full w-full cursor-zoom-in overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100 transition-colors group-hover:border-slate-300 dark:border-white/10 dark:bg-slate-800 dark:group-hover:border-white/20">
              {error ? (
                <div className="flex h-full w-full items-center justify-center">
                  <svg className="h-4 w-4 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                </div>
              ) : isLoading || !imageSrc ? (
                <div className="h-full w-full animate-pulse bg-slate-200 dark:bg-slate-700" />
              ) : (
                <Image
                  ref={imgRef}
                  src={imageSrc}
                  alt={attachment.name ?? t("input.image.alt")}
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              )}
            </div>
          </ImageLightbox>
          {onRemove && (
            <button
              type="button"
              className={cn(
                "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                "opacity-0 transition-opacity group-hover:opacity-100",
                "shadow-sm"
              )}
              onClick={() => onRemove(attachment.id)}
              aria-label={t("input.attachment.remove")}
              disabled={disabled}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="group relative overflow-hidden rounded-xl shadow-sm border border-slate-200/70 dark:border-white/10 bg-white dark:bg-background/60">
        <ImageLightbox
          src={attachment.url}
          alt={attachment.name ?? t("input.image.alt")}
        >
          <div className="relative h-28 w-full cursor-zoom-in bg-slate-100 dark:bg-slate-800">
            {error ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                {t("input.image.errorLoad")}
              </div>
            ) : isLoading || !imageSrc ? (
              <div className="h-full w-full animate-pulse bg-slate-200 dark:bg-slate-700" />
            ) : (
              <Image
                ref={imgRef}
                src={imageSrc}
                alt={attachment.name ?? t("input.image.alt")}
                width={240}
                height={240}
                className="h-full w-full object-cover"
                unoptimized
              />
            )}
          </div>
        </ImageLightbox>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2 py-1.5 text-[10px] text-white backdrop-blur-sm">
          <span className="truncate">
            {attachment.name ?? t("input.image.alt")}
          </span>
          {typeof attachment.size === "number" && (
            <span className="shrink-0">{formatFileSize(attachment.size)}</span>
          )}
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.attachment.id === nextProps.attachment.id &&
      prevProps.attachment.url === nextProps.attachment.url &&
      prevProps.variant === nextProps.variant &&
      prevProps.disabled === nextProps.disabled
    )
  }
)

ImageAttachmentItem.displayName = "ImageAttachmentItem"

const FileAttachmentItem = React.memo<AttachmentItemProps>(
  ({ attachment, variant, onRemove, disabled }) => {
    const t = useI18n("chat")
    const isUserVariant = variant === "user"

    if (isUserVariant) {
      return (
        <div className="group relative flex h-16 w-56 shrink-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2 dark:border-white/10 dark:bg-slate-900/60">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
              {attachment.name ?? t("input.attachment.untitled")}
            </div>
            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {typeof attachment.size === "number"
                ? formatFileSize(attachment.size)
                : attachment.type || ""}
            </div>
          </div>
          {onRemove && (
            <button
              type="button"
              className={cn(
                "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                "opacity-0 transition-opacity group-hover:opacity-100",
                "shadow-sm"
              )}
              onClick={() => onRemove(attachment.id)}
              aria-label={t("input.attachment.remove")}
              disabled={disabled}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white/90 p-3 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {attachment.name ?? t("input.attachment.untitled")}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {typeof attachment.size === "number"
              ? formatFileSize(attachment.size)
              : attachment.type || attachment.fileId || ""}
          </div>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.attachment.id === nextProps.attachment.id &&
      prevProps.attachment.fileId === nextProps.attachment.fileId &&
      prevProps.attachment.name === nextProps.attachment.name &&
      prevProps.attachment.size === nextProps.attachment.size &&
      prevProps.attachment.type === nextProps.attachment.type &&
      prevProps.variant === nextProps.variant &&
      prevProps.disabled === nextProps.disabled
    )
  }
)

FileAttachmentItem.displayName = "FileAttachmentItem"

function AttachmentItem({ attachment, variant, onRemove, disabled }: AttachmentItemProps) {
  if (isFileAttachment(attachment)) {
    return (
      <FileAttachmentItem
        attachment={attachment}
        variant={variant}
        onRemove={onRemove}
        disabled={disabled}
      />
    )
  }

  return (
    <ImageAttachmentItem
      attachment={attachment}
      variant={variant}
      onRemove={onRemove}
      disabled={disabled}
    />
  )
}

export const AttachmentPreview = React.memo<AttachmentPreviewProps>(
  ({ attachments, variant = "user", onRemove, disabled, className }) => {
    const isUserVariant = variant === "user"

    const validAttachments = React.useMemo(
      () =>
        attachments.filter(
          (attachment) => isFileAttachment(attachment) || Boolean(attachment.url)
        ),
      [attachments]
    )

    const imageAttachments = React.useMemo(
      () => validAttachments.filter((attachment) => !isFileAttachment(attachment)),
      [validAttachments]
    )

    const fileAttachments = React.useMemo(
      () => validAttachments.filter((attachment) => isFileAttachment(attachment)),
      [validAttachments]
    )

    if (validAttachments.length === 0) {
      return null
    }

    if (isUserVariant) {
      return (
        <div className={cn("flex flex-wrap items-center gap-2", className)}>
          {validAttachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              variant={variant}
              onRemove={onRemove}
              disabled={disabled}
            />
          ))}
        </div>
      )
    }

    return (
      <div
        className={cn(
          "rounded-2xl border p-3 shadow-sm space-y-2",
          "border-slate-200/70 dark:border-white/10",
          "bg-slate-50/80 dark:bg-muted/30",
          className
        )}
      >
        {imageAttachments.length ? (
          <div
            className={cn(
              "grid gap-2",
              imageAttachments.length > 3 ? "grid-cols-3" : "grid-cols-2"
            )}
          >
            {imageAttachments.map((attachment) => (
              <AttachmentItem
                key={attachment.id}
                attachment={attachment}
                variant={variant}
                onRemove={onRemove}
                disabled={disabled}
              />
            ))}
          </div>
        ) : null}

        {fileAttachments.length ? (
          <div className="space-y-2">
            {fileAttachments.map((attachment) => (
              <AttachmentItem
                key={attachment.id}
                attachment={attachment}
                variant={variant}
                onRemove={onRemove}
                disabled={disabled}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  },
  (prevProps, nextProps) => {
    if (prevProps.attachments.length !== nextProps.attachments.length) {
      return false
    }
    const attachmentsEqual = prevProps.attachments.every((prev, index) => {
      const next = nextProps.attachments[index]
      return (
        prev.id === next.id &&
        prev.url === next.url &&
        prev.fileId === next.fileId &&
        prev.name === next.name &&
        prev.kind === next.kind
      )
    })
    if (!attachmentsEqual) {
      return false
    }
    return (
      prevProps.variant === nextProps.variant &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.className === nextProps.className &&
      prevProps.onClear === nextProps.onClear
    )
  }
)

AttachmentPreview.displayName = "AttachmentPreview"
