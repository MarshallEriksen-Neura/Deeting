"use client"

import * as React from "react"
import { RefreshCw, ThumbsUp, ThumbsDown, Copy, Check, Bot, BookMarked } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog"
import { Textarea } from "@/ui/shadcn/textarea"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import {
  buildChatFeedbackPayload,
  hasActionableFeedbackReason,
  type ChatFeedbackReasonPayload,
} from "@/lib/chat/feedback-payload"
import { copyContent } from "@/lib/utils/copy-to-clipboard"

const POSITIVE_REASON_IDS = [
  "meets_request",
  "delivered_artifact",
  "good_reasoning",
  "good_format",
  "other_positive",
] as const

const NEGATIVE_REASON_IDS = [
  "missing_artifact",
  "wrong_requirement",
  "fact_error",
  "format_error",
  "too_generic",
  "unsafe_or_overreach",
  "other_negative",
] as const

interface MessageActionsProps {
  messageId: string
  content?: string
  onRegenerate?: (messageId: string) => void
  onLike?: (messageId: string, payload?: ChatFeedbackReasonPayload) => void | Promise<void>
  onDislike?: (messageId: string, payload?: ChatFeedbackReasonPayload) => void | Promise<void>
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
    const [dialogScore, setDialogScore] = React.useState<1 | -1 | null>(null)
    const [selectedReasonIds, setSelectedReasonIds] = React.useState<string[]>([])
    const [comment, setComment] = React.useState("")
    const [submitting, setSubmitting] = React.useState(false)

    const isFeedbackDialogOpen = dialogScore !== null
    const reasonIds = dialogScore === -1 ? NEGATIVE_REASON_IDS : POSITIVE_REASON_IDS
    const feedbackPayload = React.useMemo(
      () =>
        buildChatFeedbackPayload(
          dialogScore === -1 ? "negative" : "positive",
          selectedReasonIds,
          comment
        ),
      [comment, dialogScore, selectedReasonIds]
    )
    const canSubmitFeedback =
      dialogScore === 1 || (dialogScore === -1 && hasActionableFeedbackReason(feedbackPayload))

    const handleRegenerate = React.useCallback(() => {
      onRegenerate?.(messageId)
    }, [messageId, onRegenerate])

    const handleLike = React.useCallback(() => {
      setDialogScore(1)
      setSelectedReasonIds([])
      setComment("")
    }, [])

    const handleDislike = React.useCallback(() => {
      setDialogScore(-1)
      setSelectedReasonIds([])
      setComment("")
    }, [])

    const handleDialogOpenChange = React.useCallback((open: boolean) => {
      if (open || submitting) return
      setDialogScore(null)
      setSelectedReasonIds([])
      setComment("")
    }, [submitting])

    const toggleReason = React.useCallback((reasonId: string) => {
      setSelectedReasonIds((current) =>
        current.includes(reasonId)
          ? current.filter((value) => value !== reasonId)
          : [...current, reasonId]
      )
    }, [])

    const handleSubmitFeedback = React.useCallback(async () => {
      if (!dialogScore || !canSubmitFeedback) return
      const callback = dialogScore === 1 ? onLike : onDislike
      setSubmitting(true)
      try {
        await callback?.(messageId, feedbackPayload)
        setDialogScore(null)
        setSelectedReasonIds([])
        setComment("")
      } finally {
        setSubmitting(false)
      }
    }, [canSubmitFeedback, dialogScore, feedbackPayload, messageId, onDislike, onLike])

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
      <>
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
            <span className="sr-only">
              {copied ? t("actions.copied") : t("actions.copy")}
            </span>
          </Button>
        </div>
        <Dialog open={isFeedbackDialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent className="max-w-[28rem] gap-4 p-5">
            <DialogHeader>
              <DialogTitle className="text-base">
                {dialogScore === -1
                  ? t("feedback.dialog.negativeTitle")
                  : t("feedback.dialog.positiveTitle")}
              </DialogTitle>
              <DialogDescription>
                {dialogScore === -1
                  ? t("feedback.dialog.negativeDescription")
                  : t("feedback.dialog.positiveDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {reasonIds.map((reasonId) => {
                  const selected = selectedReasonIds.includes(reasonId)
                  return (
                    <Button
                      key={reasonId}
                      type="button"
                      variant={selected ? "ios-segment-active" : "outline"}
                      size="xs"
                      disabled={submitting}
                      className="h-auto min-h-7 rounded-full px-3 py-1 text-xs whitespace-normal text-left"
                      onClick={() => toggleReason(reasonId)}
                    >
                      {t(`feedback.reasons.${reasonId}`)}
                    </Button>
                  )
                })}
              </div>
              <Textarea
                value={comment}
                disabled={submitting}
                maxLength={800}
                placeholder={t("feedback.dialog.commentPlaceholder")}
                className="min-h-24 resize-none text-sm"
                onChange={(event) => setComment(event.target.value)}
              />
              {dialogScore === -1 && !canSubmitFeedback ? (
                <p className="text-xs text-muted-foreground">
                  {t("feedback.dialog.negativeRequired")}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => handleDialogOpenChange(false)}
              >
                {t("feedback.dialog.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!canSubmitFeedback || submitting}
                onClick={() => void handleSubmitFeedback()}
              >
                {submitting ? t("feedback.dialog.submitting") : t("feedback.dialog.submit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
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
