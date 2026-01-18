'use client';
import { ArrowUp, Sparkles, Plus, ChevronDown, Sliders } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useMarketStore } from '@/store/market-store';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';

export default function DefaultControls() {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const t = useI18n('chat');
  const installedAgents = useMarketStore((state) => state.installedAgents);
  
  const {
    input,
    setInput,
    sendMessage,
    isLoading,
    activeAssistantId,
    assistants,
    models,
    config,
    setConfig,
    setActiveAssistantId,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      setInput: state.setInput,
      sendMessage: state.sendMessage,
      isLoading: state.isLoading,
      activeAssistantId: state.activeAssistantId,
      assistants: state.assistants,
      models: state.models,
      config: state.config,
      setConfig: state.setConfig,
      setActiveAssistantId: state.setActiveAssistantId,
    }))
  );

  // Allow sending if models exist and input is valid, even if no agent is selected (we'll pick one)
  const canSend = Boolean(models.length > 0 && input.trim().length > 0 && !isLoading);
  
  const activeAssistant = useMemo(
    () => assistants.find((assistant) => assistant.id === activeAssistantId),
    [assistants, activeAssistantId]
  );
  
  const handleParamsOpenChange = (open: boolean) => {
    setIsParamsOpen(open);
  };

  const handleSend = () => {
    if (!canSend) return;

    if (!activeAssistantId) {
      // Pick the first available agent (e.g., usually the default system agent)
      const defaultAgent = installedAgents[0] || assistants[0];
      if (defaultAgent) {
        setActiveAssistantId(defaultAgent.id);
        // Seamlessly update URL without full page reload perception
        router.replace(`/chat/${defaultAgent.id}`);
        sendMessage();
      } else {
        // Fallback or error if absolutely no agents found
        console.warn("No agents available to start chat");
      }
    } else {
      sendMessage();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2 relative rounded-2xl border border-black/5 dark:border-white/10 bg-white/80 dark:bg-[#0a0a0a]/90 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      {/* 1. Main Input Area */}
      <div className="flex items-center rounded-full bg-black/5 dark:bg-white/5 px-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-11 w-full bg-transparent border-0 shadow-none text-black/80 dark:text-white/80 placeholder:text-black/35 dark:placeholder:text-white/30 text-[15px] font-normal focus-visible:ring-0 focus-visible:border-transparent"
          placeholder={t("controls.placeholder")}
          aria-label={t("controls.placeholder")}
          autoFocus
          onFocus={() => setShowMenu(false)}
        />
      </div>

      {/* 2. Action Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Mode Trigger (The "Magic" Button) */}
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("controls.menu")}
              onClick={() => setShowMenu(!showMenu)}
              className={`
                size-10 rounded-full transition-all duration-300
                ${showMenu ? 'bg-black text-white dark:bg-white dark:text-black rotate-45' : 'bg-black/5 dark:bg-white/10 text-black/60 dark:text-white hover:bg-black/10 dark:hover:bg-white/20 hover:scale-105'}
              `}
            >
              <Plus className="w-5 h-5" />
            </Button>

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
                      <span className="text-sm font-medium text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white">
                        {t("controls.image")}
                      </span>
                    </div>
                  </Link>
                  <Link href="/chat/coder" scroll={false}>
                    <div className="flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-110 transition-all">
                        <span className="font-mono text-xs font-bold">{`</>`}</span>
                      </div>
                      <span className="text-sm font-medium text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white">
                        {t("controls.code")}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Agent Selector */}
          <Button
            asChild
            variant="ghost"
            className="h-10 rounded-full px-2.5 gap-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            <Link href="/chat" scroll={false} aria-label={t("hud.selectAgent")}>
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm bg-gradient-to-br ${
                  activeAssistant?.color ?? "from-slate-400 to-slate-600"
                }`}
              >
                {(activeAssistant?.name?.trim().slice(0, 1).toUpperCase() ?? "A")}
              </span>
              <span className="text-[12px] font-semibold text-black/70 dark:text-white/70 max-w-[120px] truncate">
                {activeAssistant?.name ?? t("hud.selectAgent")}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-black/30 dark:text-white/30" />
            </Link>
          </Button>

          <Popover open={isParamsOpen} onOpenChange={handleParamsOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${t("hud.temperature")} / ${t("hud.topP")}`}
                title={`${t("hud.temperature")} / ${t("hud.topP")}`}
                className={`size-9 rounded-full bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10 ${isParamsOpen ? "ring-1 ring-indigo-500/30" : ""}`}
              >
                <Sliders className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-72 rounded-2xl border border-black/5 dark:border-white/10 bg-white/90 dark:bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-bold text-black/50 dark:text-white/50 flex items-center gap-1.5">
                      {t("hud.temperature")}
                    </label>
                    <span className="text-[10px] font-mono font-bold">{config.temperature}</span>
                  </div>
                  <Slider
                    value={[config.temperature]}
                    min={0}
                    max={2}
                    step={0.1}
                    aria-label={t("hud.temperature")}
                    onValueChange={(value) => setConfig({ temperature: Number(value[0].toFixed(2)) })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-bold text-black/50 dark:text-white/50 flex items-center gap-1.5">
                      {t("hud.topP")}
                    </label>
                    <span className="text-[10px] font-mono font-bold">{config.topP}</span>
                  </div>
                  <Slider
                    value={[config.topP]}
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={t("hud.topP")}
                    onValueChange={(value) => setConfig({ topP: Number(value[0].toFixed(2)) })}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* HUD Controls + Send */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            onClick={() => handleSend()}
            disabled={!canSend}
            className={`
              size-10 rounded-full bg-black text-white dark:bg-white/10 dark:text-white
              hover:bg-gray-800 dark:hover:bg-white dark:hover:text-black transition-all duration-300 active:scale-95 shadow-sm
              ${!canSend ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            aria-label={t("controls.send")}
          >
            <ArrowUp className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
