'use client';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { AIResponseBubble } from './ai-response-bubble';
import { MarkdownViewer } from '@/components/chat/markdown-viewer';
import { normalizeMessage } from '@/lib/chat/message-normalizer';
import Image from 'next/image';
import type { ChatImageAttachment } from '@/lib/chat/message-content';
import { Loader2 } from 'lucide-react';

export default function Canvas() {
  const t = useI18n('chat');
  const {
    messages,
    isLoading,
    historyHasMore,
    historyLoading,
    loadMoreHistory,
    statusStage,
    statusCode,
    statusMeta,
    streamEnabled
  } = useChatStore(useShallow((state) => ({
    messages: state.messages,
    isLoading: state.isLoading,
    historyHasMore: state.historyHasMore,
    historyLoading: state.historyLoading,
    loadMoreHistory: state.loadMoreHistory,
    statusStage: state.statusStage,
    statusCode: state.statusCode,
    statusMeta: state.statusMeta,
    streamEnabled: state.streamEnabled
  })));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hud = document.querySelector<HTMLElement>('[data-chat-hud]');
    const controls = document.querySelector<HTMLElement>('[data-chat-controls]');
    const fallbackTop = 112;
    const fallbackBottom = 152;

    const updateOffsets = () => {
      const hudHeight = hud?.getBoundingClientRect().height ?? 0;
      const controlsHeight = controls?.getBoundingClientRect().height ?? 0;
      const topOffset = Math.max(hudHeight + 24, fallbackTop);
      const bottomOffset = Math.max(controlsHeight + 24, fallbackBottom);
      container.style.setProperty('--chat-hud-offset', `${topOffset}px`);
      container.style.setProperty('--chat-controls-offset', `${bottomOffset}px`);
    };

    updateOffsets();

    const observers: ResizeObserver[] = [];
    if (hud) {
      const observer = new ResizeObserver(updateOffsets);
      observer.observe(hud);
      observers.push(observer);
    }
    if (controls) {
      const observer = new ResizeObserver(updateOffsets);
      observer.observe(controls);
      observers.push(observer);
    }

    window.addEventListener('resize', updateOffsets);

    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener('resize', updateOffsets);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isLoading) {
       messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleLoadMore = useCallback(async () => {
    if (!historyHasMore || historyLoading) return;
    const container = containerRef.current;
    if (!container) return;
    restoreScrollRef.current = {
      height: container.scrollHeight,
      top: container.scrollTop,
    };
    await loadMoreHistory();
    requestAnimationFrame(() => {
      const snapshot = restoreScrollRef.current;
      const node = containerRef.current;
      if (!snapshot || !node) return;
      const delta = node.scrollHeight - snapshot.height;
      node.scrollTop = snapshot.top + delta;
      restoreScrollRef.current = null;
    });
  }, [historyHasMore, historyLoading, loadMoreHistory]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 120) {
        void handleLoadMore();
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleLoadMore]);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  // Check if we need a standalone loading bubble (when loading but no assistant message yet)
  const showStandaloneLoading = isLoading && (!lastAssistantId || messages[messages.length - 1].role === 'user');

  if (messages.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
         <div className="relative group cursor-default">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 opacity-20 blur-3xl animate-pulse group-hover:opacity-30 transition-opacity duration-500" />
            <h1 className="relative text-6xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-slate-900/90 to-slate-500/60 dark:from-white/95 dark:to-white/50">
               {t("canvas.title")}
            </h1>
         </div>
         <div className="mt-4 text-sm text-slate-600 dark:text-white/50 font-mono flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            {t("canvas.subtitle")}
         </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-auto px-4 scrollbar-hide"
      style={{
        paddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
        paddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
        scrollPaddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
        scrollPaddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
      }}
    >
      <div className="max-w-5xl 2xl:max-w-6xl mx-auto flex flex-col gap-8 pt-2">
        {historyLoading && (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{t("history.loading")}</span>
          </div>
        )}
        {messages.map((msg) => {
          const isLastAssistant = msg.id === lastAssistantId;
          const isActive = isLastAssistant && isLoading;

          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} className="flex justify-start w-full">
                <div className="flex w-full flex-col gap-3 max-w-[92%]">
                  <AIResponseBubble
                    parts={msg.blocks ?? normalizeMessage(msg.content)}
                    isActive={isActive}
                    streamEnabled={streamEnabled}
                    statusStage={isActive ? statusStage : null}
                    statusCode={isActive ? statusCode : null}
                    statusMeta={isActive ? statusMeta : null}
                    reveal={!isLoading && !streamEnabled && isLastAssistant}
                  />
                  {msg.attachments?.length ? (
                    <MessageAttachments attachments={msg.attachments} alt={t("input.image.alt")} />
                  ) : null}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-end w-full">
              <div 
                className="
                  max-w-[88%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm
                  bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-tr-sm
                "
              >
                {msg.attachments?.length ? (
                  <div className="mb-3">
                    <MessageAttachments attachments={msg.attachments} variant="user" alt={t("input.image.alt")} />
                  </div>
                ) : null}
                <MarkdownViewer
                  content={msg.content}
                  className="chat-markdown chat-markdown-user"
                />
              </div>
            </div>
          );
        })}

        {/* Standalone Loading Bubble (for initial wait before first token) */}
        {showStandaloneLoading && (
           <div className="flex justify-start w-full">
             <AIResponseBubble
                parts={[]}
                isActive={true}
                streamEnabled={streamEnabled}
                statusStage={statusStage}
                statusCode={statusCode}
                statusMeta={statusMeta}
             />
           </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function MessageAttachments({
  attachments,
  alt,
  variant = "assistant",
}: {
  attachments: ChatImageAttachment[]
  alt: string
  variant?: "assistant" | "user"
}) {
  const gridCols = attachments.length > 2 ? "grid-cols-3" : "grid-cols-2";
  const cardBg = variant === "user" ? "bg-white/10" : "bg-white/70 dark:bg-white/5";

  return (
    <div className={`grid gap-2 ${gridCols}`}>
      {attachments
        .filter((attachment) => attachment.url)
        .map((attachment) => (
        <div
          key={attachment.id}
          className={`relative overflow-hidden rounded-xl border border-white/10 shadow-sm ${cardBg}`}
        >
          <Image
            src={attachment.url ?? ""}
            alt={attachment.name ?? alt}
            width={280}
            height={280}
            className="h-24 w-full object-cover"
            unoptimized
          />
          <div className="absolute inset-x-0 bottom-0 bg-black/35 px-2 py-1 text-[10px] text-white/80">
            <span className="truncate">
              {attachment.name ?? alt}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
