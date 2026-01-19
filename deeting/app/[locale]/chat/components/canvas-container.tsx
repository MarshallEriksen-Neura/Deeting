'use client';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useEffect, useRef, useMemo } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { AIResponseBubble } from './ai-response-bubble';
import { MarkdownViewer } from '@/components/chat/markdown-viewer';
import { normalizeMessage } from '@/lib/chat/message-normalizer';

export default function Canvas() {
  const t = useI18n('chat');
  const {
    messages,
    isLoading,
    statusStage,
    statusCode,
    statusMeta,
    streamEnabled
  } = useChatStore(useShallow((state) => ({
    messages: state.messages,
    isLoading: state.isLoading,
    statusStage: state.statusStage,
    statusCode: state.statusCode,
    statusMeta: state.statusMeta,
    streamEnabled: state.streamEnabled
  })));

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isLoading) {
       messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

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
    <div className="w-full h-full overflow-y-auto p-4 pb-32 scrollbar-hide">
      <div className="max-w-3xl mx-auto flex flex-col gap-8 pt-20">
        {messages.map((msg) => {
          const isLastAssistant = msg.id === lastAssistantId;
          const isActive = isLastAssistant && isLoading;

          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} className="flex justify-start w-full">
                <AIResponseBubble
                  parts={normalizeMessage(msg.content)}
                  isActive={isActive}
                  streamEnabled={streamEnabled}
                  statusStage={isActive ? statusStage : null}
                  statusCode={isActive ? statusCode : null}
                  statusMeta={isActive ? statusMeta : null}
                  reveal={!isLoading && !streamEnabled && isLastAssistant}
                />
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-end w-full">
              <div 
                className="
                  max-w-[80%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm
                  bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-tr-sm
                "
              >
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
