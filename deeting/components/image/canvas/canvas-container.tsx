'use client';

import { useEffect, useRef, useMemo, useCallback, memo, Suspense, lazy } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Loader2 } from 'lucide-react';
import { useChatStore } from '@/store/chat-store';
import { useI18n } from '@/hooks/use-i18n';
import { normalizeMessage } from '@/lib/chat/message-normalizer';
import type { ChatImageAttachment } from '@/lib/chat/message-content';
import { MarkdownViewer } from '@/components/chat/markdown-viewer';
import { CanvasSkeleton } from '@/components/common/skeletons';

// 动态导入 AIResponseBubble 组件实现代码分割
const AIResponseBubble = lazy(() =>
  import('@/components/chat/messages/ai-response-bubble').then(mod => ({
    default: mod.AIResponseBubble
  }))
);

/**
 * 消息附件组件
 * 使用 React.memo 优化渲染性能
 */
const MessageAttachments = memo<{
  attachments: ChatImageAttachment[];
  alt: string;
  variant?: "assistant" | "user";
}>(({ attachments, alt, variant = "assistant" }) => {
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
            <img
              src={attachment.url ?? ""}
              alt={attachment.name ?? alt}
              loading="lazy"
              className="h-24 w-full object-cover"
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
});

MessageAttachments.displayName = 'MessageAttachments';

/**
 * 用户消息气泡组件
 * 使用 React.memo 优化渲染性能
 */
const UserMessageBubble = memo<{
  content: string;
  attachments?: ChatImageAttachment[];
  imageAlt: string;
}>(({ content, attachments, imageAlt }) => {
  return (
    <div className="flex justify-end w-full">
      <div 
        className="
          max-w-[88%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm
          bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-tr-sm
        "
      >
        {attachments?.length ? (
          <div className="mb-3">
            <MessageAttachments attachments={attachments} variant="user" alt={imageAlt} />
          </div>
        ) : null}
        <MarkdownViewer
          content={content}
          className="chat-markdown chat-markdown-user"
        />
      </div>
    </div>
  );
});

UserMessageBubble.displayName = 'UserMessageBubble';

/**
 * 助手消息气泡组件
 * 使用 React.memo 优化渲染性能
 */
const AssistantMessageBubble = memo<{
  blocks: any[];
  attachments?: ChatImageAttachment[];
  isActive: boolean;
  streamEnabled: boolean;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  reveal: boolean;
  imageAlt: string;
}>(({ blocks, attachments, isActive, streamEnabled, statusStage, statusCode, statusMeta, reveal, imageAlt }) => {
  return (
    <div className="flex justify-start w-full">
      <div className="flex w-full flex-col gap-3 max-w-[92%]">
        <Suspense fallback={<CanvasSkeleton />}>
          <AIResponseBubble
            parts={blocks}
            isActive={isActive}
            streamEnabled={streamEnabled}
            statusStage={isActive ? statusStage : null}
            statusCode={isActive ? statusCode : null}
            statusMeta={isActive ? statusMeta : null}
            reveal={reveal}
          />
        </Suspense>
        {attachments?.length ? (
          <MessageAttachments attachments={attachments} alt={imageAlt} />
        ) : null}
      </div>
    </div>
  );
});

AssistantMessageBubble.displayName = 'AssistantMessageBubble';

/**
 * 画布容器组件
 * 
 * 功能：
 * - 显示聊天消息列表
 * - 自动滚动到底部
 * - 加载历史消息
 * - 动态调整布局偏移
 * 
 * 性能优化：
 * - 使用 React.memo 优化子组件
 * - 使用 useMemo 缓存计算结果
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 Suspense 和 lazy 实现代码分割
 */
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

  // 使用 useCallback 缓存加载更多处理函数
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

  // 使用 useMemo 缓存最后一条助手消息 ID
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  // Check if we need a standalone loading bubble (when loading but no assistant message yet)
  const showStandaloneLoading = isLoading && (!lastAssistantId || messages[messages.length - 1].role === 'user');

  const imageAlt = t("input.image.alt");

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
              <AssistantMessageBubble
                key={msg.id}
                blocks={msg.blocks ?? normalizeMessage(msg.content)}
                attachments={msg.attachments}
                isActive={isActive}
                streamEnabled={streamEnabled}
                statusStage={statusStage}
                statusCode={statusCode}
                statusMeta={statusMeta}
                reveal={!isLoading && !streamEnabled && isLastAssistant}
                imageAlt={imageAlt}
              />
            );
          }

          return (
            <UserMessageBubble
              key={msg.id}
              content={msg.content}
              attachments={msg.attachments}
              imageAlt={imageAlt}
            />
          );
        })}

        {/* Standalone Loading Bubble (for initial wait before first token) */}
        {showStandaloneLoading && (
           <div className="flex justify-start w-full">
             <Suspense fallback={<CanvasSkeleton />}>
               <AIResponseBubble
                  parts={[]}
                  isActive={true}
                  streamEnabled={streamEnabled}
                  statusStage={statusStage}
                  statusCode={statusCode}
                  statusMeta={statusMeta}
               />
             </Suspense>
           </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
