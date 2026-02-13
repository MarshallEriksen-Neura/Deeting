"use client"

import * as React from "react"
import Image from "next/image"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { useLazyImage } from "@/hooks/use-lazy-image"
import type { ChatImageAttachment } from "@/lib/chat/message-content"

/**
 * AttachmentPreview 组件 - 附件预览
 * 
 * 用于展示聊天消息中的图片附件，支持懒加载和删除操作。
 * 使用 React.memo 优化性能，避免不必要的重渲染。
 * 
 * @example
 * ```tsx
 * // 用户输入场景
 * <AttachmentPreview
 *   attachments={attachments}
 *   variant="user"
 *   onRemove={handleRemove}
 *   onClear={handleClear}
 * />
 * 
 * // 助手消息场景（只读）
 * <AttachmentPreview
 *   attachments={attachments}
 *   variant="assistant"
 * />
 * ```
 */

interface AttachmentPreviewProps {
  /** 附件列表 */
  attachments: ChatImageAttachment[]
  /** 变体类型：assistant（助手消息）或 user（用户输入） */
  variant?: 'assistant' | 'user'
  /** 删除单个附件的回调 */
  onRemove?: (id: string) => void
  /** 清空所有附件的回调 */
  onClear?: () => void
  /** 是否禁用交互 */
  disabled?: boolean
  /** 自定义类名 */
  className?: string
}

/**
 * 单个附件项组件
 * 使用 useLazyImage Hook 实现图片懒加载
 */
interface AttachmentItemProps {
  attachment: ChatImageAttachment
  variant: 'assistant' | 'user'
  onRemove?: (id: string) => void
  disabled?: boolean
}

const AttachmentItem = React.memo<AttachmentItemProps>(
  ({ attachment, variant, onRemove, disabled }) => {
    const t = useI18n("chat")
    const isUserVariant = variant === 'user'

    const { imageSrc, isLoading, error, imgRef } = useLazyImage({
      src: attachment.url ?? "",
      rootMargin: '50px',
      threshold: 0.01,
    })

    if (!attachment.url) {
      return null
    }

    // 用户输入场景：紧凑缩略图
    if (isUserVariant) {
      return (
        <div className="group relative h-16 w-16 shrink-0">
          <div className="h-full w-full overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-100 dark:bg-slate-800 transition-colors group-hover:border-slate-300 dark:group-hover:border-white/20">
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
              aria-label={t("input.image.remove")}
              disabled={disabled}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )
    }

    // 助手消息场景：保持原有卡片样式
    return (
      <div className="group relative overflow-hidden rounded-xl shadow-sm border border-slate-200/70 dark:border-white/10 bg-white dark:bg-background/60">
        <div className="relative h-28 w-full bg-slate-100 dark:bg-slate-800">
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
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2 py-1.5 text-[10px] text-white backdrop-blur-sm">
          <span className="truncate">
            {attachment.name ?? t("input.image.alt")}
          </span>
          {typeof attachment.size === "number" && (
            <span className="shrink-0">
              {Math.max(1, Math.round(attachment.size / 1024))} KB
            </span>
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

AttachmentItem.displayName = "AttachmentItem"

/**
 * AttachmentPreview 主组件
 */
export const AttachmentPreview = React.memo<AttachmentPreviewProps>(
  ({ attachments, variant = 'user', onRemove, onClear, disabled, className }) => {
    const isUserVariant = variant === 'user'

    const validAttachments = React.useMemo(
      () => attachments.filter((attachment) => attachment.url),
      [attachments]
    )

    if (validAttachments.length === 0) {
      return null
    }

    // 用户输入场景：紧凑的水平缩略图条
    if (isUserVariant) {
      return (
        <div className={cn("flex items-center gap-2", className)}>
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

    // 助手消息场景：保持网格布局
    return (
      <div
        className={cn(
          "rounded-2xl border p-3 shadow-sm",
          "border-slate-200/70 dark:border-white/10",
          "bg-slate-50/80 dark:bg-muted/30",
          className
        )}
      >
        <div
          className={cn(
            "grid gap-2",
            validAttachments.length > 3 ? "grid-cols-3" : "grid-cols-2"
          )}
        >
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
      </div>
    )
  },
  (prevProps, nextProps) => {
    if (prevProps.attachments.length !== nextProps.attachments.length) {
      return false
    }
    const attachmentsEqual = prevProps.attachments.every((prev, index) => {
      const next = nextProps.attachments[index]
      return prev.id === next.id && prev.url === next.url
    })
    if (!attachmentsEqual) {
      return false
    }
    return (
      prevProps.variant === nextProps.variant &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.className === nextProps.className
    )
  }
)

AttachmentPreview.displayName = "AttachmentPreview"
