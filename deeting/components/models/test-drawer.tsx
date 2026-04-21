"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Clock, Zap, AlertCircle, Sparkles, RotateCcw, Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GlassButton } from "@/components/ui/common/glass-button";
import { GlassCard } from "@/components/ui/common/glass-card";
import { Badge } from "@/components/ui/shadcn/badge";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/shadcn/sheet";
import type { ProviderModel, TestMessage } from "./types";
import { CAPABILITY_META, formatContextWindow } from "./types";

interface TestDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  model: ProviderModel | null;
  instanceName: string;
  onSendMessage: (message: string) => Promise<TestMessage>;
}

function ChatBubble({ message }: { message: TestMessage }) {
  const [copied, setCopied] = React.useState(false);
  const isUser = message.role === "user";
  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex w-full min-w-0 flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div className={cn("group relative min-w-0 max-w-[85%] rounded-2xl px-4 py-3", isUser ? "rounded-br-md bg-[var(--primary)] text-white" : "rounded-bl-md border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)]")}>
        <p className="max-w-full whitespace-pre-wrap break-words text-sm">{message.content}</p>
        <button onClick={handleCopy} className={cn("absolute -right-2 top-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100", isUser ? "bg-white/20 text-white hover:bg-white/30" : "bg-[var(--panel-bg)] text-[var(--ink-3)] hover:bg-[var(--panel-bg)]")}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      {!isUser && (message.latency || message.tokens) ? (
        <div className="flex items-center gap-3 px-2 text-[10px] text-[var(--ink-3)]">
          {message.latency ? <span className="flex items-center gap-1"><Clock className="size-3" />{message.latency}ms</span> : null}
          {message.tokens ? <span className="flex items-center gap-1"><Zap className="size-3" />{message.tokens} tokens</span> : null}
        </div>
      ) : null}
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex items-start">
      <div className="rounded-2xl rounded-bl-md border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 0.2, 0.4].map((delay) => (
            <motion.span key={delay} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay }} className="size-2 rounded-full bg-[var(--primary)]" />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyChatState({ modelId }: { modelId: string }) {
  const t = useTranslations("models");
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <motion.div animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 3, repeat: Infinity }} className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
        <Sparkles className="size-8 text-[var(--primary)]" />
      </motion.div>
      <h3 className="mb-2 text-lg font-medium text-[var(--ink)]">Test {modelId}</h3>
      <p className="max-w-[250px] text-sm text-[var(--ink-3)]">{t("test.send")}</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useTranslations("models");
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-4 my-2">
      <GlassCard className="border-[var(--danger-border)] bg-[var(--danger-soft)]" padding="sm" hover="none">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--danger)]">{t("test.connectionError")}</p>
            <p className="mt-1 text-xs text-[var(--danger)] opacity-80">{error}</p>
          </div>
          <GlassButton variant="ghost" size="sm" onClick={onRetry} className="text-[var(--danger)] hover:bg-[var(--danger-soft)]">
            <RotateCcw className="mr-1 size-3" />
            {t("test.retry")}
          </GlassButton>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function TestDrawer({ isOpen, onClose, model, instanceName, onSendMessage }: TestDrawerProps) {
  const t = useTranslations("models");
  const [messages, setMessages] = React.useState<TestMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const modelId = model?.id ?? null;

  React.useEffect(() => {
    if (modelId) {
      setMessages([]);
      setInput("");
      setError(null);
    }
  }, [modelId]);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  React.useEffect(() => {
    if (isOpen && textareaRef.current) setTimeout(() => textareaRef.current?.focus(), 300);
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !model) return;
    const userMessage: TestMessage = { id: `msg_${Date.now()}`, role: "user", content: input.trim(), timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);
    try {
      const response = await onSendMessage(userMessage.content);
      setMessages((prev) => [...prev, response]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  if (!model) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col border-l border-[var(--hairline)] bg-[var(--panel-bg)] p-0 backdrop-blur-xl sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-[var(--hairline)] px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 pr-8">
              <SheetTitle className="truncate text-lg font-semibold">{model.display_name || model.id}</SheetTitle>
              <SheetDescription className="mt-0.5 truncate font-mono text-xs text-[var(--ink-3)]">via {instanceName}</SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {model.capabilities.slice(0, 3).map((capability) => (
              <Badge key={capability} variant="outline" className="border-[var(--hairline)] px-2 py-0.5 text-[10px] text-[var(--ink-3)]">
                {CAPABILITY_META[capability].icon} {t(`capabilities.${capability}.label`)}
              </Badge>
            ))}
            <Badge variant="outline" className="border-[var(--hairline)] px-2 py-0.5 text-[10px] text-[var(--ink-3)]">{formatContextWindow(model.context_window)} context</Badge>
          </div>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4">
            <div className="space-y-4 py-4">
              {messages.length === 0 ? <EmptyChatState modelId={model.id} /> : (
                <>
                  {messages.map((message) => <ChatBubble key={message.id} message={message} />)}
                  <AnimatePresence>{isLoading ? <TypingIndicator /> : null}</AnimatePresence>
                </>
              )}
            </div>
          </div>
          {error ? <ErrorState error={error} onRetry={() => setError(null)} /> : null}
        </div>
        <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--panel-bg)] p-4">
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <Textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder={t("test.placeholder")} className="max-h-[120px] min-h-[44px] resize-none border-[var(--hairline)] bg-[var(--panel-bg-inset)] pr-10 focus:border-[var(--primary)]/50" rows={1} />
              {messages.length > 0 ? <button onClick={() => { setMessages([]); setError(null); }} className="absolute right-2 top-2 p-1 text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]" title={t("test.clearChat")}><RotateCcw className="size-4" /></button> : null}
            </div>
            <GlassButton onClick={() => void handleSend()} disabled={!input.trim() || isLoading} size="icon" className="shrink-0">
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </GlassButton>
          </div>
          <p className="mt-2 text-center text-[10px] text-[var(--ink-3)]">{t("test.hint")}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
