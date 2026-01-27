'use client';

import { ArrowUp, Sparkles, Plus, ChevronDown, Sliders, MessageSquarePlus, ImagePlus, X, Square, Clapperboard } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useMemo, useRef, useState, useCallback, memo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useMarketStore } from '@/store/market-store';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { buildImageAttachments, UPLOAD_ERROR_CODES } from '@/lib/chat/attachments';

/**
 * ControlsContainer - 聊天控制面板组件
 * 
 * 功能：
 * - 消息输入和发送
 * - 附件管理（图片上传、预览、删除）
 * - 参数配置（temperature, topP）
 * - 助手选择
 * - 新建会话
 * - 模式切换（聊天/图像/代码）
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算值
 */
function ControlsContainer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showMenu, setShowMenu] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useI18n('chat');
  const installedAgents = useMarketStore((state) => state.installedAgents);
  
  const {
    input,
    attachments,
    setInput,
    sendMessage,
    isLoading,
    activeAssistantId,
    assistants,
    models,
    config,
    setConfig,
    setActiveAssistantId,
    resetSession,
    addAttachments,
    removeAttachment,
    clearAttachments,
    cancelActiveRequest,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      attachments: state.attachments,
      setInput: state.setInput,
      sendMessage: state.sendMessage,
      isLoading: state.isLoading,
      activeAssistantId: state.activeAssistantId,
      assistants: state.assistants,
      models: state.models,
      config: state.config,
      setConfig: state.setConfig,
      setActiveAssistantId: state.setActiveAssistantId,
      resetSession: state.resetSession,
      addAttachments: state.addAttachments,
      removeAttachment: state.removeAttachment,
      clearAttachments: state.clearAttachments,
      cancelActiveRequest: state.cancelActiveRequest,
    }))
  );

  // 缓存计算值
  const canSend = useMemo(
    () => Boolean(models.length > 0 && (input.trim().length > 0 || attachments.length > 0) && !isLoading),
    [models.length, input, attachments.length, isLoading]
  );
  
  const isGenerating = isLoading;
  
  const activeAssistant = useMemo(
    () => assistants.find((assistant) => assistant.id === activeAssistantId),
    [assistants, activeAssistantId]
  );
  
  // 缓存事件处理函数
  const handleParamsOpenChange = useCallback((open: boolean) => {
    setIsParamsOpen(open);
  }, []);

  const handleNewChat = useCallback(() => {
    resetSession();
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("session");
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(url || "/chat");
  }, [resetSession, searchParams, pathname, router]);

  const handleSelectAssistant = useCallback((assistantId: string) => {
    setActiveAssistantId(assistantId);
    router.replace(`/chat/${assistantId}`);
  }, [setActiveAssistantId, router]);

  const handleSend = useCallback(() => {
    if (!canSend) return;

    if (!activeAssistantId) {
      const defaultAgent = installedAgents[0] || assistants[0];
      if (defaultAgent) {
        setActiveAssistantId(defaultAgent.id);
        router.replace(`/chat/${defaultAgent.id}`);
        sendMessage();
      } else {
        console.warn("No agents available to start chat");
      }
    } else {
      sendMessage();
    }
  }, [canSend, activeAssistantId, installedAgents, assistants, setActiveAssistantId, router, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAttachmentError(null);
    const result = await buildImageAttachments(files);
    if (result.skipped > 0 && result.attachments.length === 0) {
      setAttachmentError(t("input.image.errorInvalid"));
      return;
    }
    if (result.attachments.length) {
      addAttachments(result.attachments);
    }
    if (result.rejected > 0) {
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      );
      setAttachmentError(
        hasUploadError ? t("input.image.errorUpload") : t("input.image.errorRead")
      );
    }
  }, [t, addAttachments]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    if (isLoading) return;
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const files = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];
    if (files.length) {
      void handleFiles(files);
    }
  }, [isLoading, handleFiles]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) {
      await handleFiles(files);
      event.target.value = "";
    }
  }, [handleFiles]);

  const handleTemperatureChange = useCallback((value: number[]) => {
    setConfig({ temperature: Number(value[0].toFixed(2)) });
  }, [setConfig]);

  const handleTopPChange = useCallback((value: number[]) => {
    setConfig({ topP: Number(value[0].toFixed(2)) });
  }, [setConfig]);

  const handleToggleMenu = useCallback(() => {
    setShowMenu(prev => !prev);
  }, []);

  const handleInputFocus = useCallback(() => {
    setShowMenu(false);
  }, []);

  const handleFileInputClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSendOrCancel = useCallback(() => {
    if (isGenerating) {
      void cancelActiveRequest();
      return;
    }
    handleSend();
  }, [isGenerating, cancelActiveRequest, handleSend]);

  // 缓存附件网格类名
  const attachmentGridClassName = useMemo(
    () => cn("grid gap-2", attachments.length > 3 ? "grid-cols-3" : "grid-cols-2"),
    [attachments.length]
  );

  return (
    <div className="flex flex-col gap-2 p-2 relative rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white/90 dark:bg-[#0a0a0a]/90 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.2)] backdrop-blur-xl">
      {/* 1. Main Input Area */}
      <div className="flex items-center rounded-2xl bg-slate-100/80 dark:bg-white/5 px-3 py-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="min-h-[44px] w-full bg-transparent border-0 shadow-none text-slate-800 dark:text-white/80 placeholder:text-slate-500 dark:placeholder:text-white/30 text-[15px] font-normal focus-visible:ring-0 focus-visible:border-transparent"
          placeholder={t("controls.placeholder")}
          aria-label={t("controls.placeholder")}
          autoFocus
          onFocus={handleInputFocus}
        />
        <Popover open={isParamsOpen} onOpenChange={handleParamsOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${t("hud.temperature")} / ${t("hud.topP")}`}
              title={`${t("hud.temperature")} / ${t("hud.topP")}`}
              className={`min-h-[44px] min-w-[44px] size-10 rounded-full bg-white/70 dark:bg-white/10 text-slate-600 dark:text-white/70 hover:bg-white/90 dark:hover:bg-white/20 cursor-pointer ${isParamsOpen ? "ring-2 ring-indigo-500/30" : ""}`}
            >
              <Sliders className="w-5 h-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-72 rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white/95 dark:bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-white/50 flex items-center gap-1.5">
                    {t("hud.temperature")}
                  </label>
                  <span className="text-[11px] font-mono font-bold">{config.temperature}</span>
                </div>
                <Slider
                  value={[config.temperature]}
                  min={0}
                  max={2}
                  step={0.1}
                  aria-label={t("hud.temperature")}
                  onValueChange={handleTemperatureChange}
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-white/50 flex items-center gap-1.5">
                    {t("hud.topP")}
                  </label>
                  <span className="text-[11px] font-mono font-bold">{config.topP}</span>
                </div>
                <Slider
                  value={[config.topP]}
                  min={0}
                  max={1}
                  step={0.05}
                  aria-label={t("hud.topP")}
                  onValueChange={handleTopPChange}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {attachments.length > 0 ? (
        <div className="flex flex-col gap-2 px-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-white/50">
            <span>{t("input.image.summary", { count: attachments.length })}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px] h-8 px-3 text-[11px] sm:h-7 sm:min-h-0 hover:bg-slate-200/70 dark:hover:bg-white/10"
              onClick={clearAttachments}
              disabled={isLoading}
            >
              {t("input.image.clear")}
            </Button>
          </div>
          <div className={attachmentGridClassName}>
            {attachments
              .filter((attachment) => attachment.url)
              .map((attachment) => (
              <div
                key={attachment.id}
                className="group relative overflow-hidden rounded-xl border border-slate-200/70 dark:border-white/10 bg-white/70 dark:bg-white/5 shadow-sm"
              >
                <Image
                  src={attachment.url ?? ""}
                  alt={attachment.name ?? t("input.image.alt")}
                  width={240}
                  height={240}
                  className="h-24 w-full object-cover"
                  unoptimized
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] text-white/90 backdrop-blur-sm">
                  <span className="truncate">
                    {attachment.name ?? t("input.image.alt")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 min-h-[44px] min-w-[44px] h-8 w-8 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 transition-all group-hover:opacity-100 sm:h-7 sm:w-7 sm:min-h-0 sm:min-w-0"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={t("input.image.remove")}
                  disabled={isLoading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {attachmentError ? (
        <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90">{attachmentError}</div>
      ) : null}

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
              onClick={handleToggleMenu}
              className={`
                min-h-[44px] min-w-[44px] size-11 rounded-full transition-all duration-300 cursor-pointer
                ${showMenu ? 'bg-slate-900 text-white dark:bg-white dark:text-black rotate-45' : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white hover:bg-slate-200/70 dark:hover:bg-white/20 hover:scale-105'}
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
                  className="absolute bottom-full left-0 mb-2 bg-white/95 dark:bg-[#1a1a1a] border border-slate-200/70 dark:border-white/10 rounded-2xl p-2 shadow-xl backdrop-blur-xl flex flex-col gap-1 w-44 z-50 origin-bottom-left"
                >
                  <Link href="/chat/create/image" scroll={false}>
                    <div className="flex items-center gap-3 p-3 min-h-[44px] hover:bg-slate-100/80 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-all">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-white/80 group-hover:text-slate-900 dark:group-hover:text-white">
                        {t("controls.image")}
                      </span>
                    </div>
                  </Link>
                  <Link href="/video" scroll={false}>
                    <div className="flex items-center gap-3 p-3 min-h-[44px] hover:bg-slate-100/80 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center text-red-600 dark:text-red-400 group-hover:scale-110 transition-all">
                        <Clapperboard className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-white/80 group-hover:text-slate-900 dark:group-hover:text-white">
                        {t("controls.video") || "Video"}
                      </span>
                    </div>
                  </Link>
                  <Link href="/chat/coder" scroll={false}>
                    <div className="flex items-center gap-3 p-3 min-h-[44px] hover:bg-slate-100/80 dark:hover:bg-white/10 rounded-xl cursor-pointer group transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-110 transition-all">
                        <span className="font-mono text-sm font-bold">{`</>`}</span>
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-white/80 group-hover:text-slate-900 dark:group-hover:text-white">
                        {t("controls.code")}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* New Chat Button */}
          <Button
             type="button"
             variant="ghost"
             size="icon"
             onClick={handleNewChat}
             aria-label={t("header.newChat")}
             className="min-h-[44px] min-w-[44px] size-11 rounded-full bg-slate-100/80 dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
             <MessageSquarePlus className="w-5 h-5" />
          </Button>

          {/* Agent Selector (Opens Select Agent Modal) */}
          <Button
            asChild
            variant="ghost"
            className="min-h-[44px] h-11 rounded-full px-3 gap-2 bg-slate-100/80 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Link href="/chat/select-agent" scroll={false} aria-label={t("hud.selectAgent")}>
              <span
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm bg-gradient-to-br ${
                  activeAssistant?.color ?? "from-slate-400 to-slate-600"
                }`}
              >
                {(activeAssistant?.name?.trim().slice(0, 1).toUpperCase() ?? "A")}
              </span>
              <span className="text-[13px] font-semibold text-slate-700 dark:text-white/70 max-w-[100px] truncate">
                {activeAssistant?.name ?? t("hud.selectAgent")}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-500 dark:text-white/30" />
            </Link>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("input.image.add")}
            onClick={handleFileInputClick}
            className="min-h-[44px] min-w-[44px] size-10 rounded-full bg-slate-100/80 dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
            disabled={isLoading}
          >
            <ImagePlus className="w-5 h-5" />
          </Button>
        </div>

        {/* HUD Controls + Send */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            onClick={handleSendOrCancel}
            disabled={isGenerating ? false : !canSend}
            className={`
              min-h-[44px] min-w-[44px] size-11 rounded-full bg-slate-900 text-white dark:bg-white/10 dark:text-white
              hover:bg-slate-800 dark:hover:bg-white dark:hover:text-black transition-all duration-300 active:scale-95 shadow-sm
              ${isGenerating ? 'cursor-pointer' : !canSend ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            aria-label={isGenerating ? t("controls.stop") : t("controls.send")}
          >
            {isGenerating ? <Square className="w-5 h-5" /> : <ArrowUp className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={isLoading}
      />
    </div>
  );
}

// 使用 React.memo 优化，避免不必要的重渲染
export default memo(ControlsContainer);
