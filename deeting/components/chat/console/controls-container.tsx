'use client';

import { ArrowUp, Sparkles, Plus, Sliders, MessageSquarePlus, Paperclip, X, Square, FileText, Play, Check, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useMemo, useRef, useState, useCallback, useEffect, memo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chat-store';
import { useI18n } from '@/hooks/use-i18n';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/utils/file';
import { buildChatAttachments, UPLOAD_ERROR_CODES, ATTACHMENT_INVALID_ERROR_CODES } from '@/lib/chat/attachments';
import { createConversation } from '@/lib/api/conversations';
import { useChatMessaging } from '@/hooks/chat/use-chat-messaging';
import { listLocalUserDocuments } from '@/lib/api/knowledge';
import type { KnowledgeFile } from '@/types/knowledge';
import { listCustomTaskAgents, type CustomTaskAgentProfile } from '@/lib/api/custom-task-agents';
import { resolveLeadingTaskAgentMention } from '@/hooks/chat/task-agent-mention';

// Temporary product choice: hide the coder jump from the main chat composer menu.
const SHOW_CHAT_CODER_SHORTCUT = false;

/**
 * ControlsContainer - 聊天控制面板组件
 * 
 * 功能：
 * - 消息输入和发送
 * - 附件管理（图片上传、预览、删除）
 * - 参数配置（temperature, topP）
 * - 桌面知识文件挂载
 * - 新建会话
 * - 模式切换（聊天/图像/代码）
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算值
 */
function ControlsContainer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showMenu, setShowMenu] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isKnowledgePickerOpen, setIsKnowledgePickerOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeLoadError, setKnowledgeLoadError] = useState<string | null>(null);
  const [taskAgents, setTaskAgents] = useState<CustomTaskAgentProfile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useI18n('chat');
  const {
    input,
    attachments,
    selectedKnowledgeFileIds,
    setInput,
    setMessages,
    selectedAssistant,
    models,
    config,
    setConfig,
    addAttachments,
    removeAttachment,
    clearAttachments,
    toggleSelectedKnowledgeFileId,
    clearSelectedKnowledgeFileIds,
    isLoading,
    setSessionId,
    setGlobalLoading,
    resetSession,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      attachments: state.attachments,
      selectedKnowledgeFileIds: state.selectedKnowledgeFileIds,
      setInput: state.setInput,
      setMessages: state.setMessages,
      selectedAssistant: state.selectedAssistant,
      models: state.models,
      config: state.config,
      setConfig: state.setConfig,
      addAttachments: state.addAttachments,
      removeAttachment: state.removeAttachment,
      clearAttachments: state.clearAttachments,
      toggleSelectedKnowledgeFileId: state.toggleSelectedKnowledgeFileId,
      clearSelectedKnowledgeFileIds: state.clearSelectedKnowledgeFileIds,
      isLoading: state.isLoading,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
      resetSession: state.resetSession,
    }))
  );

  const isTauriRuntime = detectTauriRuntime();

  const {
    handleSendMessage,
    cancelActiveRequest,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  } = useChatMessaging({
    agent: !isTauriRuntime && selectedAssistant
      ? { id: selectedAssistant.id, name: selectedAssistant.name }
      : undefined,
    isTauriRuntime,
  });

  // 缓存计算值
  const canSend = useMemo(
    () => Boolean(models.length > 0 && (input.trim().length > 0 || attachments.length > 0) && !isLoading),
    [models.length, input, attachments.length, isLoading]
  );
  const selectedModel = useMemo(
    () =>
      models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
      models[0],
    [models, config.model]
  );

  const knowledgeFileMap = useMemo(() => {
    return new Map(knowledgeFiles.map((file) => [file.id, file]));
  }, [knowledgeFiles]);

  const isGenerating = isLoading;
  const canContinueGeneration = useMemo(
    () =>
      !isGenerating &&
      hasInterruptedGeneration &&
      input.trim().length === 0 &&
      attachments.length === 0,
    [isGenerating, hasInterruptedGeneration, input, attachments.length]
  );
  
  // 缓存事件处理函数
  const handleParamsOpenChange = useCallback((open: boolean) => {
    setIsParamsOpen(open);
  }, []);

  const loadIndexedKnowledgeFiles = useCallback(async () => {
    if (!isTauriRuntime) return;
    setKnowledgeLoading(true);
    setKnowledgeLoadError(null);
    try {
      const files = await listLocalUserDocuments({ status: "indexed" });
      setKnowledgeFiles(files);
    } catch (error) {
      console.warn("load_indexed_knowledge_files_failed", error);
      setKnowledgeLoadError(t("controls.knowledgePickerLoadFailed"));
    } finally {
      setKnowledgeLoading(false);
    }
  }, [isTauriRuntime, t]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    if (!isKnowledgePickerOpen) return;
    void loadIndexedKnowledgeFiles();
  }, [isTauriRuntime, isKnowledgePickerOpen, loadIndexedKnowledgeFiles]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    let cancelled = false;
    void listCustomTaskAgents()
      .then((items) => {
        if (!cancelled) setTaskAgents(items);
      })
      .catch((error) => {
        console.warn("load_task_agents_failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isTauriRuntime]);

  const resolvedTaskAgentMention = useMemo(() => {
    if (!isTauriRuntime) return null;
    return resolveLeadingTaskAgentMention(
      input,
      taskAgents.map((agent) => ({ id: agent.id, name: agent.name })),
    );
  }, [input, isTauriRuntime, taskAgents]);

  const handleNewChat = useCallback(async () => {
    resetSession();
    setMessages([]);
    clearAttachments();
    setGlobalLoading(true);
    try {
      const created = await createConversation({});
      if (created.session_id) {
        setSessionId(created.session_id);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(searchParams?.toString());
          params.set("session", created.session_id);
          params.delete("agentId");
          const basePath = "/chat";
          const query = params.toString();
          const nextUrl = query ? `${basePath}?${query}` : basePath;
          window.history.replaceState(null, "", nextUrl);
        }
        return;
      }
    } catch (error) {
      console.warn("create_conversation_failed", error);
    } finally {
      setGlobalLoading(false);
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(searchParams?.toString());
      params.delete("session");
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      window.history.replaceState(null, "", url || "/chat");
    }
  }, [
    resetSession,
    setMessages,
    clearAttachments,
    searchParams,
    pathname,
    setSessionId,
    setGlobalLoading,
  ]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    handleSendMessage();
  }, [
    canSend,
    handleSendMessage,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAttachmentError(null);
    const result = await buildChatAttachments(files, {
      model: selectedModel?.id,
      providerModelId: selectedModel?.provider_model_id ?? undefined,
    });
    if (result.attachments.length) {
      addAttachments(result.attachments);
    }
    if (result.rejected > 0) {
      const hasInvalidError = result.errors.some((error) =>
        ATTACHMENT_INVALID_ERROR_CODES.has(error)
      );
      if (hasInvalidError) {
        setAttachmentError(t("input.attachment.errorInvalid"));
        return;
      }
      const hasUploadError = result.errors.some((error) =>
        UPLOAD_ERROR_CODES.has(error)
      );
      setAttachmentError(
        hasUploadError ? t("input.attachment.errorUpload") : t("input.attachment.errorRead")
      );
    }
  }, [t, addAttachments, selectedModel]);

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

  const handleKnowledgePickerOpenChange = useCallback((open: boolean) => {
    setIsKnowledgePickerOpen(open);
  }, []);

  const handleToggleKnowledgeFile = useCallback((fileId: string) => {
    toggleSelectedKnowledgeFileId(fileId);
  }, [toggleSelectedKnowledgeFileId]);

  const handleRemoveKnowledgeFile = useCallback((fileId: string) => {
    toggleSelectedKnowledgeFileId(fileId);
  }, [toggleSelectedKnowledgeFileId]);

  const handleClearKnowledgeFiles = useCallback(() => {
    clearSelectedKnowledgeFileIds();
  }, [clearSelectedKnowledgeFileIds]);

  const handleSendOrCancel = useCallback(() => {
    if (isGenerating) {
      void cancelActiveRequest();
      return;
    }
    if (canContinueGeneration) {
      void continueInterruptedGeneration();
      return;
    }
    handleSend();
  }, [
    isGenerating,
    canContinueGeneration,
    cancelActiveRequest,
    continueInterruptedGeneration,
    handleSend,
  ]);

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
        <div className="flex flex-wrap items-center gap-2 px-1">
          {attachments.map((attachment) => {
            const isFileAttachment = attachment.kind === "file" || Boolean(attachment.fileId);

            if (isFileAttachment) {
              return (
                <div
                  key={attachment.id}
                  className="group relative flex h-16 w-52 shrink-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2 dark:border-white/10 dark:bg-slate-900/60"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                      {attachment.name ?? t("input.attachment.untitled")}
                    </div>
                    <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                      {typeof attachment.size === "number" ? formatFileSize(attachment.size) : attachment.type || ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                      "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                      "opacity-0 transition-opacity group-hover:opacity-100",
                      "shadow-sm"
                    )}
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={t("input.attachment.remove")}
                    disabled={isLoading}
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </button>
                </div>
              );
            }

            if (!attachment.url) {
              return null;
            }

            return (
              <div
                key={attachment.id}
                className="group relative h-16 w-16 shrink-0"
              >
                <div className="h-full w-full overflow-hidden rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-100 dark:bg-slate-800 transition-colors group-hover:border-slate-300 dark:group-hover:border-white/20">
                  <Image
                    src={attachment.url}
                    alt={attachment.name ?? t("input.image.alt")}
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                </div>
                <button
                  type="button"
                  className={cn(
                    "absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full",
                    "bg-slate-500 text-white hover:bg-slate-700 dark:bg-slate-400 dark:text-black dark:hover:bg-slate-200",
                    "opacity-0 transition-opacity group-hover:opacity-100",
                    "shadow-sm"
                  )}
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={t("input.attachment.remove")}
                  disabled={isLoading}
                >
                  <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {isTauriRuntime && selectedKnowledgeFileIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {selectedKnowledgeFileIds.map((fileId) => {
            const file = knowledgeFileMap.get(fileId);
            return (
              <div
                key={fileId}
                className="group relative flex h-8 max-w-[240px] shrink-0 items-center gap-2 rounded-full border border-sky-200/80 bg-sky-50 px-3 text-xs text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200"
              >
                <span className="truncate">
                  {file?.name ?? fileId}
                </span>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-sky-200/60 dark:hover:bg-sky-500/30"
                  onClick={() => handleRemoveKnowledgeFile(fileId)}
                  aria-label={t("controls.knowledgeRemove")}
                  disabled={isLoading}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs text-slate-600 dark:text-white/70"
            onClick={handleClearKnowledgeFiles}
            disabled={isLoading}
          >
            {t("controls.knowledgeClear")}
          </Button>
        </div>
      ) : null}

      {attachmentError ? (
        <div className="text-center text-xs font-medium text-red-500/90 dark:text-red-400/90">{attachmentError}</div>
      ) : null}

      {resolvedTaskAgentMention ? (
        <div className="text-center text-xs font-medium text-slate-500/90 dark:text-muted-foreground">
          {resolvedTaskAgentMention.agent
            ? t("input.taskAgentRouted", { name: resolvedTaskAgentMention.agent.name })
            : t("input.taskAgentMissing", { name: resolvedTaskAgentMention.mention.agentName })}
        </div>
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
                  {SHOW_CHAT_CODER_SHORTCUT ? (
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
                  ) : null}
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

          {isTauriRuntime ? null : (
            <div className="min-h-[44px] h-11 rounded-full px-3 gap-2 bg-slate-100/80 dark:bg-white/5 flex items-center">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm bg-gradient-to-br ${selectedAssistant?.color ?? "from-slate-400 to-slate-600"}`}>
                {(selectedAssistant?.name?.trim().slice(0, 1).toUpperCase() ?? "A")}
              </span>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/40">
                  {t("routing.locked")}
                </span>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-white/80 max-w-[120px] truncate">
                  {selectedAssistant?.name ?? t("routing.locked")}
                </span>
              </div>
            </div>
          )}

          {isTauriRuntime ? (
            <Popover open={isKnowledgePickerOpen} onOpenChange={handleKnowledgePickerOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("controls.knowledge")}
                  className="min-h-[44px] min-w-[44px] size-10 rounded-full bg-slate-100/80 dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  disabled={isLoading}
                >
                  <FileText className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white/95 dark:bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-white/85">
                    {t("controls.knowledgePickerTitle")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2 text-xs"
                    onClick={() => void loadIndexedKnowledgeFiles()}
                    disabled={knowledgeLoading}
                  >
                    {knowledgeLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      t("controls.knowledgeRefresh")
                    )}
                  </Button>
                </div>

                {knowledgeLoading ? (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-500 dark:text-white/50">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("controls.knowledgePickerLoading")}
                  </div>
                ) : knowledgeLoadError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
                    {knowledgeLoadError}
                  </div>
                ) : knowledgeFiles.length === 0 ? (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                    {t("controls.knowledgePickerEmpty")}
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {knowledgeFiles.map((file) => {
                      const isSelected = selectedKnowledgeFileIds.includes(file.id);
                      return (
                        <button
                          key={file.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                            isSelected
                              ? "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                              : "hover:bg-slate-100/80 dark:hover:bg-white/10"
                          )}
                          onClick={() => handleToggleKnowledgeFile(file.id)}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{file.name}</span>
                            <span className="block truncate text-[10px] text-slate-500 dark:text-white/45">
                              {formatFileSize(file.size)} · {file.chunks ?? 0} chunks
                            </span>
                          </span>
                          {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("input.attachment.add")}
            onClick={handleFileInputClick}
            className="min-h-[44px] min-w-[44px] size-10 rounded-full bg-slate-100/80 dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
            disabled={isLoading}
          >
            <Paperclip className="w-5 h-5" />
          </Button>
        </div>

        {/* HUD Controls + Send */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            onClick={handleSendOrCancel}
            disabled={isGenerating ? false : canContinueGeneration ? false : !canSend}
            className={`
              min-h-[44px] min-w-[44px] size-11 rounded-full bg-slate-900 text-white dark:bg-white/10 dark:text-white
              hover:bg-slate-800 dark:hover:bg-white dark:hover:text-black transition-all duration-300 active:scale-95 shadow-sm
              ${isGenerating || canContinueGeneration ? 'cursor-pointer' : !canSend ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            aria-label={isGenerating ? t("controls.stop") : canContinueGeneration ? t("controls.continue") : t("controls.send")}
          >
            {isGenerating ? (
              <Square className="w-5 h-5" />
            ) : canContinueGeneration ? (
              <Play className="w-5 h-5" />
            ) : (
              <ArrowUp className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      <Input
        ref={fileInputRef}
        type="file"
        accept="*/*"
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
