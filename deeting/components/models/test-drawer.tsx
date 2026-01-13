"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Send,
  Loader2,
  X,
  Clock,
  Zap,
  AlertCircle,
  Sparkles,
  RotateCcw,
  Copy,
  Check,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import type { ProviderModel, TestMessage, TestSession } from "./types"
import { CAPABILITY_META, formatContextWindow } from "./types"

/**
 * TestDrawer - The Mini-Playground
 *
 * A slide-out debug drawer for quickly testing models without page navigation.
 * Features a simple chat interface with latency and token metrics.
 */

interface TestDrawerProps {
  isOpen: boolean
  onClose: () => void
  model: ProviderModel | null
  instanceName: string
  onSendMessage: (message: string) => Promise<TestMessage>
}

// Chat bubble component
function ChatBubble({
  message,
  isLast,
}: {
  message: TestMessage
  isLast: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  const isUser = message.role === "user"

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Message Bubble */}
      <div
        className={cn(
          "relative group max-w-[85%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-[var(--primary)] text-white rounded-br-md"
            : "bg-white/5 text-[var(--foreground)] rounded-bl-md border border-white/10"
        )}
      >
        {/* Content */}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </p>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className={cn(
            "absolute -right-2 top-0 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
            isUser
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-white/10 text-[var(--muted)] hover:bg-white/20"
          )}
        >
          {copied ? (
            <Check className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </div>

      {/* Metadata (for assistant messages) */}
      {!isUser && (message.latency || message.tokens) && (
        <div className="flex items-center gap-3 px-2 text-[10px] text-[var(--muted)]">
          {message.latency && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {message.latency}ms
            </span>
          )}
          {message.tokens && (
            <span className="flex items-center gap-1">
              <Zap className="size-3" />
              {message.tokens} tokens
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

// Typing indicator
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-start"
    >
      <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3 border border-white/10">
        <div className="flex items-center gap-1">
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
            className="size-2 rounded-full bg-[var(--primary)]"
          />
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
            className="size-2 rounded-full bg-[var(--primary)]"
          />
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
            className="size-2 rounded-full bg-[var(--primary)]"
          />
        </div>
      </div>
    </motion.div>
  )
}

// Empty state for the chat
function EmptyChatState({ modelId }: { modelId: string }) {
  const t = useTranslations('models')
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <motion.div
        animate={{
          scale: [1, 1.05, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{ duration: 3, repeat: Infinity }}
        className="size-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center mb-4"
      >
        <Sparkles className="size-8 text-[var(--primary)]" />
      </motion.div>
      <h3 className="text-lg font-medium text-[var(--foreground)] mb-2">
        Test {modelId}
      </h3>
      <p className="text-sm text-[var(--muted)] max-w-[250px]">
        {t('test.send')}
      </p>
    </div>
  )
}

// Error state
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useTranslations('models')
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 my-2"
    >
      <GlassCard
        className="border-red-500/30 bg-red-500/10"
        padding="sm"
        hover="none"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400 font-medium">
              {t('test.connectionError')}
            </p>
            <p className="text-xs text-red-400/80 mt-1">{error}</p>
          </div>
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="text-red-400 hover:bg-red-500/10"
          >
            <RotateCcw className="size-3 mr-1" />
            {t('test.retry')}
          </GlassButton>
        </div>
      </GlassCard>
    </motion.div>
  )
}

export function TestDrawer({
  isOpen,
  onClose,
  model,
  instanceName,
  onSendMessage,
}: TestDrawerProps) {
  const t = useTranslations('models')
  const [messages, setMessages] = React.useState<TestMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Reset state when model changes
  React.useEffect(() => {
    if (model) {
      setMessages([])
      setInput("")
      setError(null)
    }
  }, [model?.id])

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  // Focus textarea when drawer opens
  React.useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 300)
    }
  }, [isOpen])

  const handleSend = async () => {
    if (!input.trim() || isLoading || !model) return

    const userMessage: TestMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setError(null)

    try {
      const response = await onSendMessage(userMessage.content)
      setMessages((prev) => [...prev, response])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    setError(null)
  }

  if (!model) return null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col backdrop-blur-xl bg-[var(--background)]/90 border-l border-white/10"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 pr-8">
              <SheetTitle className="text-lg font-semibold truncate">
                {model.display_name || model.id}
              </SheetTitle>
              <SheetDescription className="text-xs font-mono text-[var(--muted)] truncate mt-0.5">
                via {instanceName}
              </SheetDescription>
            </div>
          </div>

          {/* Model Quick Info */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {model.capabilities.slice(0, 3).map((cap) => (
              <Badge
                key={cap}
                variant="outline"
                className="text-[10px] px-2 py-0.5 border-white/20"
              >
                {CAPABILITY_META[cap].icon} {t(`capabilities.${cap}.label`)}
              </Badge>
            ))}
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0.5 border-white/20"
            >
              {formatContextWindow(model.context_window)} context
            </Badge>
          </div>
        </SheetHeader>

        {/* Chat Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <ScrollArea
            ref={scrollRef}
            className="flex-1 px-4"
          >
            <div className="py-4 space-y-4">
              {messages.length === 0 ? (
                <EmptyChatState modelId={model.id} />
              ) : (
                <>
                  {messages.map((message, i) => (
                    <ChatBubble
                      key={message.id}
                      message={message}
                      isLast={i === messages.length - 1}
                    />
                  ))}
                  <AnimatePresence>
                    {isLoading && <TypingIndicator />}
                  </AnimatePresence>
                </>
              )}
            </div>
          </ScrollArea>

          {/* Error Display */}
          {error && (
            <ErrorState error={error} onRetry={() => setError(null)} />
          )}
        </div>

        {/* Input Area */}
        <div className="shrink-0 p-4 border-t border-white/10 bg-[var(--background)]/50">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('test.placeholder')}
                className="min-h-[44px] max-h-[120px] resize-none bg-white/5 border-white/10 focus:border-[var(--primary)]/50 pr-10"
                rows={1}
              />
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="absolute right-2 top-2 p-1 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  title={t('test.clearChat')}
                >
                  <RotateCcw className="size-4" />
                </button>
              )}
            </div>
            <GlassButton
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </GlassButton>
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-2 text-center">
            {t('test.hint')}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default TestDrawer
