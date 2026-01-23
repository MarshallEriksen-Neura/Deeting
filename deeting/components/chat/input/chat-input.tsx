"use client"

import * as React from "react"
import { ImagePlus, Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { useDebounce } from "@/hooks/use-debounce"
import { useChatStateStore } from "@/store/chat-state-store"
import { AttachmentPreview } from "./attachment-preview"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { buildImageAttachments, UPLOAD_ERROR_CODES } from "@/lib/chat/attachments"

/**
 * ChatInput 组件 - 聊天输入框
 * 
 * 提供消息输入、附件上传、流式模式切换等功能。
 * 使用防抖优化输入性能，使用 useCallback 缓存事件处理函数。
 * 
 * @example
 * ```tsx
 * <ChatInput
 *   inputValue={input}
 *   onInputChange={setInput}
 *   onSend={handleSend}
 *   disabled={isLoading}
 *   placeholderName={agent.name}
 *   errorMessage={error}
 *   attachments={attachments}
 *   onRemoveAttachment={removeAttachment}
 *   onClearAttachments={clearAttachments}
 *   streamEnabled={streamEnabled}
 *   onStreamChange={setStreamEnabled}
 * />
 * ```
 */

interface ChatInputProps {
  /** 输入框的值 */
  inputValue: string
  /** 输入变化回调 */
  onInputChange: (value: string) => void
  /** 发送消息回调 */
  onSend: () => void
  /** 是否禁用输入 */
  disabled: boolean
  /** 占位符中显示的名称 */
  placeholderName: string
  /** 错误消息 */
  errorMessage: string | null
  /** 附件列表 */
  attachments: ChatImageAttachment[]
  /** 删除附件回调 */
  onRemoveAttachment: (attachmentId: string) => void
  /** 清空附件回调 */
  onClearAttachments: () => void
  /** 是否启用流式模式 */
  streamEnabled: boolean
  /** 流式模式切换回调 */
  onStreamChange: (enabled: boolean) => void
  /** 粘贴事件回调（可选） */
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void
  /** 是否正在生成 */
  isGenerating?: boolean
  /** 取消生成回调 */
  onCancel?: () => void
}

export const ChatInput = React.memo<ChatInputProps>(
  ({
    inputValue,
    onInputChange,
    onSend,
    disabled,
    placeholderName,
    errorMessage,
    attachments,
    onRemoveAttachment,
    onClearAttachments,
    streamEnabled,
    onStreamChange,
    onPaste,
    isGenerating,
    onCancel
  }) => {
    const t = useI18n("chat")
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const [attachmentError, setAttachmentError] = React.useState<string | null>(null)
    
    // 使用 attachments hook 来处理文件上传
    const { addAttachments } = useChatStateStore()
    
    // 应用防抖优化（300ms）
    // 注意：这里我们对内部状态应用防抖，而不是直接对 inputValue 防抖
    // 因为 inputValue 是受控的，我们需要立即更新显示，但可以延迟触发某些副作用
    const debouncedInputValue = useDebounce(inputValue, 300)
    
    // 计算是否有内容（使用防抖后的值进行某些判断）
    const hasContent = Boolean(inputValue.trim() || attachments.length)
    const canCancel = Boolean(isGenerating && onCancel)
    
    // 使用 useMemo 缓存错误消息的解析
    const resolvedErrorMessage = React.useMemo(() => {
      if (!errorMessage) return null
      if (errorMessage.startsWith("i18n:")) {
        return t(errorMessage.slice("i18n:".length))
      }
      return errorMessage
    }, [errorMessage, t])

    // 使用 useCallback 缓存文件处理函数
    const handleFiles = React.useCallback(async (files: File[]) => {
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
    }, [t, addAttachments])

    // 使用 useCallback 缓存粘贴处理函数
    const handlePaste = React.useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
      if (disabled) return
      
      // 如果有外部 onPaste 处理器，优先使用
      if (onPaste) {
        onPaste(event)
        return
      }
      
      // 默认的粘贴处理逻辑
      const items = event.clipboardData?.items
      if (!items?.length) return
      const files = Array.from(items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[]
      if (files.length) {
        void handleFiles(files)
      }
    }, [disabled, onPaste, handleFiles])

    // 使用 useCallback 缓存文件选择处理函数
    const handleFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : []
      if (files.length) {
        await handleFiles(files)
        event.target.value = ""
      }
    }, [handleFiles])

    // 使用 useCallback 缓存键盘事件处理函数
    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (hasContent && !disabled) {
          onSend()
        }
      }
    }, [hasContent, disabled, onSend])

    // 使用 useCallback 缓存文件选择按钮点击处理函数
    const handleFileButtonClick = React.useCallback(() => {
      fileInputRef.current?.click()
    }, [])

    // 使用 useCallback 缓存发送/取消按钮点击处理函数
    const handleSendOrCancel = React.useCallback(() => {
      if (canCancel && onCancel) {
        onCancel()
      } else {
        onSend()
      }
    }, [canCancel, onCancel, onSend])

    return (
      <div className="safe-bottom p-3 sm:p-4 border-t border-slate-200/70 dark:border-white/10 bg-white/90 dark:bg-[#0a0a0a]/90 backdrop-blur-xl">
        <div className="max-w-5xl 2xl:max-w-6xl mx-auto space-y-3">
          {/* 使用 AttachmentPreview 组件替换内联代码 */}
          {attachments.length > 0 && (
            <AttachmentPreview
              attachments={attachments}
              variant="user"
              onRemove={onRemoveAttachment}
              onClear={onClearAttachments}
              disabled={disabled}
            />
          )}

          <div className="relative flex items-end gap-3">
            {/* 流式模式切换 */}
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

            {/* 图片上传按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 min-h-[44px] min-w-[44px] h-11 w-11 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
              onClick={handleFileButtonClick}
              aria-label={t("input.image.add")}
              disabled={disabled}
            >
              <ImagePlus className="h-5 w-5 text-slate-600 dark:text-white/70" />
            </Button>
            
            {/* 输入框容器 */}
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
                onClick={handleSendOrCancel}
                disabled={canCancel ? false : !hasContent || disabled}
                aria-label={canCancel ? t("controls.stop") : t("controls.send")}
              >
                {canCancel ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
              </Button>
            </div>
            
            {/* 隐藏的文件输入 */}
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

          {/* 附件错误消息 */}
          {attachmentError && (
            <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90 py-1">
              {attachmentError}
            </div>
          )}

          {/* 通用错误消息 */}
          {resolvedErrorMessage && (
            <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90 py-1">
              {resolvedErrorMessage}
            </div>
          )}

          {/* 免责声明 */}
          <div className="text-center text-[11px] text-slate-500/70 dark:text-muted-foreground/50 leading-relaxed">
            {t("footer.disclaimer")}
          </div>
        </div>
      </div>
    )
  },
  // 自定义比较函数，优化性能
  (prevProps, nextProps) => {
    // 比较基本 props
    if (
      prevProps.inputValue !== nextProps.inputValue ||
      prevProps.disabled !== nextProps.disabled ||
      prevProps.placeholderName !== nextProps.placeholderName ||
      prevProps.errorMessage !== nextProps.errorMessage ||
      prevProps.streamEnabled !== nextProps.streamEnabled ||
      prevProps.isGenerating !== nextProps.isGenerating
    ) {
      return false
    }
    
    // 比较附件数组
    if (prevProps.attachments.length !== nextProps.attachments.length) {
      return false
    }
    
    // 比较每个附件的 ID
    const attachmentsEqual = prevProps.attachments.every((prev, index) => {
      const next = nextProps.attachments[index]
      return prev.id === next.id
    })
    
    return attachmentsEqual
  }
)

ChatInput.displayName = "ChatInput"
