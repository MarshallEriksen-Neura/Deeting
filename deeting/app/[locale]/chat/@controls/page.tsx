'use client';
import { ArrowUp, Sparkles, Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';

export default function DefaultControls() {
  const [showMenu, setShowMenu] = useState(false);
  
  const { input, setInput, sendMessage, isLoading, activeAssistantId, models } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      setInput: state.setInput,
      sendMessage: state.sendMessage,
      isLoading: state.isLoading,
      activeAssistantId: state.activeAssistantId,
      models: state.models,
    }))
  );

  const canSend = Boolean(activeAssistantId) && models.length > 0 && input.trim().length > 0 && !isLoading;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        sendMessage();
      }
    }
  };

  return (
    <div className="flex items-center p-1.5 min-h-[60px] relative">
      
      {/* 1. Mode Trigger (The "Magic" Button) */}
      <div className="relative">
        <button 
            onClick={() => setShowMenu(!showMenu)}
            className={`
                w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300
                ${showMenu ? 'bg-black text-white dark:bg-white dark:text-black rotate-45' : 'bg-black/5 dark:bg-white/10 text-black/60 dark:text-white hover:bg-black/10 dark:hover:bg-white/20 hover:scale-105'}
            `}
        >
            <Plus className="w-5 h-5" />
        </button>

        {/* Local Popover Menu for Capability Selection */}
        <AnimatePresence>
            {showMenu && (
                <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: -10, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                    className="absolute bottom-full left-0 mb-2 bg-white/80 dark:bg-[#1a1a1a] border border-black/5 dark:border-white/10 rounded-2xl p-2 shadow-xl backdrop-blur-xl flex flex-col gap-1 w-40 z-50 origin-bottom-left"
                >
                    <Link href="/chat/create/image" scroll={false}>
                        <div className="flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-all">
                                <Sparkles className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white">Image</span>
                        </div>
                    </Link>
                    <Link href="/chat/coder" scroll={false}>
                        <div className="flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                             <div className="w-8 h-8 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-110 transition-all">
                                <span className="font-mono text-xs font-bold">{`</>`}</span>
                            </div>
                            <span className="text-sm font-medium text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white">Code</span>
                        </div>
                    </Link>
                </motion.div>
            )}
        </AnimatePresence>
      </div>

      {/* 2. Main Input Area */}
      <input 
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="bg-transparent flex-1 outline-none text-black dark:text-white px-4 placeholder-black/40 dark:placeholder-white/30 text-[16px] font-normal h-full" 
        placeholder="Type a message..."
        autoFocus
        onFocus={() => setShowMenu(false)}
      />
      
      {/* 3. Send Action */}
      <button 
        onClick={() => sendMessage()}
        disabled={!canSend}
        className={`
          bg-black text-white dark:bg-white/10 dark:text-white rounded-full w-10 h-10 flex items-center justify-center 
          hover:bg-gray-800 dark:hover:bg-white dark:hover:text-black transition-all duration-300 active:scale-95 shadow-sm
          ${!canSend ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <ArrowUp className="w-5 h-5" />
      </button>

    </div>
  );
}
