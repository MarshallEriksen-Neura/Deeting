'use client';

import { useEffect, useRef, useMemo, useCallback, memo, Suspense, lazy } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Loader2, X, Download, Maximize2, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { useArtifactStore } from '@/store/artifact-store';
import { useChatMessagingService } from '@/hooks/chat/use-chat-messaging-service';
import { useI18n } from '@/hooks/use-i18n';
import type { MessageBlock } from '@/lib/chat/message-protocol';
import type { ChatImageAttachment } from '@/lib/chat/message-content';
import { MarkdownViewer } from '@/components/chat/markdown-viewer';
import { CanvasSkeleton } from '@/components/common/skeletons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
 * - 展示 Artifacts 沉浸式预览（Coze/Manus 模式）
 */
export default function Canvas() {
  const t = useI18n('chat');
  const {
    messages,
    streamEnabled,
  } = useChatStore(useShallow((state) => ({
    messages: state.messages,
    streamEnabled: state.streamEnabled,
  })));
  const {
    isLoading,
    historyHasMore,
    statusStage,
    statusCode,
    statusMeta,
  } = useChatRuntimeStore(useShallow((state) => ({
    isLoading: state.isLoading,
    historyHasMore: state.historyHasMore,
    statusStage: state.statusStage,
    statusCode: state.statusCode,
    statusMeta: state.statusMeta,
  })));

  // Artifact 联动状态
  const { activeArtifact, isOpen, closeArtifact } = useArtifactStore();

  // 映射 historyLoading 为 isLoading
  const historyLoading = isLoading;

  const { loadMoreHistory } = useChatMessagingService();

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
    <div className="flex h-full w-full overflow-hidden">
      {/* 聊天消息流 */}
      <motion.div
        ref={containerRef}
        animate={{ 
          width: isOpen ? "50%" : "100%",
          paddingRight: isOpen ? "2rem" : "1rem" 
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="h-full overflow-y-auto px-4 scrollbar-hide relative z-10"
        style={{
          paddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
          paddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
          scrollPaddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top))",
          scrollPaddingBottom: "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom))",
        }}
      >
        <div className={cn(
          "mx-auto flex flex-col gap-8 pt-2 transition-all",
          isOpen ? "max-w-full" : "max-w-5xl 2xl:max-w-6xl"
        )}>
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
              const blocks: MessageBlock[] = msg.blocks?.length ? msg.blocks : [];
              return (
                <AssistantMessageBubble
                  key={msg.id}
                  blocks={blocks}
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

          {/* Standalone Loading Bubble */}
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
      </motion.div>

      {/* Artifact 沉浸式侧边栏 (Manus/Coze 模式) */}
      <AnimatePresence>
        {isOpen && activeArtifact && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="w-1/2 h-full bg-white dark:bg-zinc-950 border-l border-border relative z-20 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                  <Monitor className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold truncate tracking-tight">{activeArtifact.name}</h2>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">{activeArtifact.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeArtifact.payload.download_url && (
                  <Button asChild size="icon" variant="ghost" className="h-9 w-9 rounded-full">
                    <a href={activeArtifact.payload.download_url} target="_blank" rel="noopener noreferrer">
                      <Download className="w-4 h-4" />
                    </a>
                  </Button>
                )}
                <Button onClick={closeArtifact} size="icon" variant="ghost" className="h-9 w-9 rounded-full hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
              <div className="max-w-3xl mx-auto">
                {activeArtifact.payload.preview_kind === 'html' ? (
                  <div className="w-full h-full min-h-[80vh] bg-white rounded-xl border border-border shadow-inner overflow-hidden">
                    <iframe 
                      srcDoc={activeArtifact.payload.preview_text}
                      className="w-full h-full border-0"
                      title="Preview"
                      sandbox="allow-scripts"
                    />
                  </div>
                ) : (
                  <MarkdownViewer 
                    content={activeArtifact.payload.preview_text || ""} 
                    className="chat-markdown chat-markdown-assistant"
                  />
                )}
              </div>
            </div>

            {/* Footer / Status */}
            <div className="px-6 py-3 border-t border-border bg-zinc-50/30 dark:bg-zinc-900/30 flex items-center justify-between text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span>沉浸式阅读模式</span>
              </div>
              <div className="flex items-center gap-3 font-mono">
                <span>UTF-8</span>
                <span>{activeArtifact.type.toUpperCase()}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
