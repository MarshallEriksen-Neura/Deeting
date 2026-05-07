"use client"

import * as React from "react"
import { RefreshCw, ThumbsUp, ThumbsDown, Copy, Check, Bot, BookMarked } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { copyContent } from "@/lib/utils/copy-to-clipboard"

interface MessageActionsProps {
  messageId: string
  content?: string
  onRegenerate?: (messageId: string) => void
  onLike?: (messageId: string) => void
  onDislike?: (messageId: string) => void
  onCopy?: (messageId: string) => void
  onCompare?: (messageId: string) => void
  onSaveToWiki?: (messageId: string) => void
  liked?: boolean
  disliked?: boolean
  canCompare?: boolean
  canSaveToWiki?: boolean
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
 * - 复制：复制回答内容到剪贴板
 * - 沉淀到 Wiki：将回答转成可预览的 LLM Wiki 候选页
 *
 * 使用 React.memo 优化性能
 */
export const MessageActions = React.memo<MessageActionsProps>(
  ({
    messageId,
    content,
    onRegenerate,
    onLike,
    onDislike,
    onCopy,
    onCompare,
    onSaveToWiki,
    liked = false,
    disliked = false,
    canCompare = false,
    canSaveToWiki = false,
    disabled = false,
    className,
  }) => {
    const t = useI18n("chat")
    const [copied, setCopied] = React.useState(false)

    const handleRegenerate = React.useCallback(() => {
      onRegenerate?.(messageId)
    }, [messageId, onRegenerate])

    const handleLike = React.useCallback(() => {
      onLike?.(messageId)
    }, [messageId, onLike])

    const handleDislike = React.useCallback(() => {
      onDislike?.(messageId)
    }, [messageId, onDislike])

    const handleCopy = React.useCallback(async () => {
      if (!content) return

      const success = await copyContent(content, false)
      if (success) {
        setCopied(true)
        onCopy?.(messageId)
        setTimeout(() => setCopied(false), 2000)
      }
    }, [content, messageId, onCopy])

    const handleCompare = React.useCallback(() => {
      onCompare?.(messageId)
    }, [messageId, onCompare])

    const handleSaveToWiki = React.useCallback(() => {
      onSaveToWiki?.(messageId)
    }, [messageId, onSaveToWiki])

    return (
      <div className={cn("flex items-center gap-1 mt-1 ml-1", className)}>
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

        {canCompare ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCompare}
            disabled={disabled}
            className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            title={t("actions.compare")}
          >
            <Bot size={14} />
            <span className="sr-only">{t("actions.compare")}</span>
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleSaveToWiki}
          disabled={disabled || !canSaveToWiki}
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          title={t("actions.saveToWiki")}
        >
          <BookMarked size={14} />
          <span className="sr-only">{t("actions.saveToWiki")}</span>
        </Button>

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

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          disabled={disabled || !content}
          className={cn(
            "h-7 w-7 hover:bg-muted/50",
            copied
              ? "text-green-500 hover:text-green-600"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={copied ? t("actions.copied") : t("actions.copy")}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="sr-only">{copied ? t("actions.copied") : t("actions.copy")}</span>
        </Button>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.messageId === nextProps.messageId &&
      prevProps.content === nextProps.content &&
      prevProps.liked === nextProps.liked &&
      prevProps.disliked === nextProps.disliked &&
      prevProps.canCompare === nextProps.canCompare &&
      prevProps.canSaveToWiki === nextProps.canSaveToWiki &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.onRegenerate === nextProps.onRegenerate &&
      prevProps.onLike === nextProps.onLike &&
      prevProps.onDislike === nextProps.onDislike &&
      prevProps.onCopy === nextProps.onCopy &&
      prevProps.onCompare === nextProps.onCompare &&
      prevProps.onSaveToWiki === nextProps.onSaveToWiki
    )
  }
)

MessageActions.displayName = "MessageActions"
