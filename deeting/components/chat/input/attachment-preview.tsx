"use client"

import * as React from "react"
import Image from "next/image"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
    
    // 使用懒加载 Hook
    const { imageSrc, isLoading, error, imgRef } = useLazyImage({
      src: attachment.url ?? "",
      rootMargin: '50px',
      threshold: 0.01,
    })

    // 如果没有 URL，不渲染
    if (!attachment.url) {
      return null
    }

    return (
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl shadow-sm border",
          "bg-white dark:bg-background/60",
          "border-slate-200/70 dark:border-white/10",
          isUserVariant && "transition-all hover:shadow-md"
        )}
      >
        {/* 图片容器 */}
        <div className="relative h-28 w-full bg-slate-100 dark:bg-slate-800">
          {error ? (
            // 加载失败占位符
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-slate-500">
              {t("input.image.errorLoad")}
            </div>
          ) : isLoading || !imageSrc ? (
            // 加载中占位符（骨架屏）
            <div className="h-full w-full animate-pulse bg-slate-200 dark:bg-slate-700" />
          ) : (
            // 实际图片
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

        {/* 底部信息栏 */}
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

        {/* 删除按钮（仅用户输入场景显示） */}
        {isUserVariant && onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "absolute right-1 top-1 h-8 w-8 rounded-full",
              "bg-black/60 text-white hover:bg-black/80",
              "opacity-0 transition-all group-hover:opacity-100",
              "min-h-[44px] min-w-[44px]",
              "sm:h-7 sm:w-7 sm:min-h-0 sm:min-w-0"
            )}
            onClick={() => onRemove(attachment.id)}
            aria-label={t("input.image.remove")}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    )
  },
  // 自定义比较函数，优化性能
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
 * 使用 React.memo 优化，避免父组件重渲染时不必要的更新
 */
export const AttachmentPreview = React.memo<AttachmentPreviewProps>(
  ({ attachments, variant = 'user', onRemove, onClear, disabled, className }) => {
    const t = useI18n("chat")
    const isUserVariant = variant === 'user'
    
    // 过滤出有效的附件（有 URL）
    const validAttachments = React.useMemo(
      () => attachments.filter((attachment) => attachment.url),
      [attachments]
    )

    // 如果没有有效附件，不渲染
    if (validAttachments.length === 0) {
      return null
    }

    return (
      <div
        className={cn(
          "rounded-2xl border p-3 shadow-sm",
          "border-slate-200/70 dark:border-white/10",
          "bg-slate-50/80 dark:bg-muted/30",
          className
        )}
      >
        {/* 头部信息栏（仅用户输入场景显示） */}
        {isUserVariant && (
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-slate-600 dark:text-muted-foreground">
              {t("input.image.summary", { count: validAttachments.length })}
            </div>
            {onClear && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 min-w-[44px] text-xs",
                  "hover:bg-slate-200/70 dark:hover:bg-white/10"
                )}
                onClick={onClear}
                disabled={disabled}
              >
                {t("input.image.clear")}
              </Button>
            )}
          </div>
        )}

        {/* 附件网格 */}
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
  // 自定义比较函数
  (prevProps, nextProps) => {
    // 比较附件数组（浅比较）
    if (prevProps.attachments.length !== nextProps.attachments.length) {
      return false
    }
    
    // 比较每个附件的 ID 和 URL
    const attachmentsEqual = prevProps.attachments.every((prev, index) => {
      const next = nextProps.attachments[index]
      return prev.id === next.id && prev.url === next.url
    })
    
    if (!attachmentsEqual) {
      return false
    }
    
    // 比较其他 props
    return (
      prevProps.variant === nextProps.variant &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.className === nextProps.className
    )
  }
)

AttachmentPreview.displayName = "AttachmentPreview"
