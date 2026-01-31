"use client"

import * as React from "react"
import { RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"

interface MessageActionsProps {
  messageId: string
  onRegenerate?: (messageId: string) => void
  onLike?: (messageId: string) => void
  onDislike?: (messageId: string) => void
  liked?: boolean
  disliked?: boolean
  disabled?: boolean
  className?: string
}

/**
 * MessageActions 组件 - AI 消息操作按钮
 *
 * 显示在 AI 响应气泡下方的操作按钮：
 * - 重新生成：重新生成当前回答
 * - 点赞：对回答表示满意
 * - 踩：对回答表示不满意
 *
 * 使用 React.memo 优化性能
 */
export const MessageActions = React.memo<MessageActionsProps>(
  ({
    messageId,
    onRegenerate,
    onLike,
    onDislike,
    liked = false,
    disliked = false,
    disabled = false,
    className,
  }) => {
    const t = useI18n("chat")

    const handleRegenerate = React.useCallback(() => {
      onRegenerate?.(messageId)
    }, [messageId, onRegenerate])

    const handleLike = React.useCallback(() => {
      onLike?.(messageId)
    }, [messageId, onLike])

    const handleDislike = React.useCallback(() => {
      onDislike?.(messageId)
    }, [messageId, onDislike])

    return (
      <div className={cn("flex items-center gap-1 mt-1 ml-1", className)}>
        {/* 重新生成按钮 */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRegenerate}
          disabled={disabled}
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          title={t("actions.regenerate")}
        >
          <RefreshCw size={14} />
          <span className="sr-only">{t("actions.regenerate")}</span>
        </Button>

        {/* 点赞按钮 */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleLike}
          disabled={disabled}
          className={cn(
            "h-7 w-7 hover:bg-muted/50",
            liked
              ? "text-green-500 hover:text-green-600"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={t("actions.like")}
        >
          <ThumbsUp size={14} className={cn(liked && "fill-current")} />
          <span className="sr-only">{t("actions.like")}</span>
        </Button>

        {/* 踩按钮 */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDislike}
          disabled={disabled}
          className={cn(
            "h-7 w-7 hover:bg-muted/50",
            disliked
              ? "text-red-500 hover:text-red-600"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={t("actions.dislike")}
        >
          <ThumbsDown size={14} className={cn(disliked && "fill-current")} />
          <span className="sr-only">{t("actions.dislike")}</span>
        </Button>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.messageId === nextProps.messageId &&
      prevProps.liked === nextProps.liked &&
      prevProps.disliked === nextProps.disliked &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.onRegenerate === nextProps.onRegenerate &&
      prevProps.onLike === nextProps.onLike &&
      prevProps.onDislike === nextProps.onDislike
    )
  }
)

MessageActions.displayName = "MessageActions"
