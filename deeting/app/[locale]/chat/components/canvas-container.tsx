'use client';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/hooks/use-i18n';

export default function Canvas() {
  const t = useI18n('chat');
  const messages = useChatStore(useShallow((state) => state.messages));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
         <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 opacity-20 blur-3xl animate-pulse" />
            <h1 className="relative text-6xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-black/80 to-black/20 dark:from-white dark:to-white/40">
               {t("canvas.title")}
            </h1>
         </div>
         <div className="mt-4 text-sm text-black/60 dark:text-white/40 font-mono flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            {t("canvas.subtitle")}
         </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto p-4 pb-32 scrollbar-hide">
      <div className="max-w-3xl mx-auto flex flex-col gap-6 pt-20">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`
                max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                ${msg.role === 'user' 
                  ? 'bg-black text-white dark:bg-white dark:text-black rounded-tr-sm' 
                  : 'bg-white/50 dark:bg-white/10 text-black dark:text-white backdrop-blur-md border border-black/5 dark:border-white/10 rounded-tl-sm'
                }
              `}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
