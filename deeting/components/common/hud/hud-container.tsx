'use client';

import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, Settings, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { useEffect, useState, useMemo, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { usePathname, useSearchParams } from 'next/navigation';
import { useChatStore, type ChatAssistant } from '@/store/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatService } from '@/hooks/use-chat-service';
import { useI18n } from '@/hooks/use-i18n';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';
import { resolveChatModelSelectionValue } from '@/lib/api/models';
import { resolveModelVisual } from '@/components/models/model-visual';
import { resolveStatusDetail } from '@/lib/chat/status-detail';
import { StatusPill } from '@/components/ui/status-pill';
import { createConversation } from '@/lib/api/conversations';
import {
  DeferredHistorySidebar,
  DeferredHudControlCenterPanel,
  DeferredHudSystemMenuPanel,
  preloadHudDeferredSurfaces,
} from './hud-lazy';

/**
 * HUD Container Component
 * 
 * 显示聊天界面的 HUD（Heads-Up Display），包括：
 * - 模型选择器
 * - 会话标题
 * - 系统菜单
 * - 历史记录侧边栏
 * 
 * 性能优化：
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算结果
 * - 使用 useShallow 优化 Zustand store 订阅
 */
export default function HUD() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const t = useI18n('chat');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const { setTheme, theme } = useTheme();
  
  const {
    config,
    setConfig,
    selectedAssistant,
    models,
    selectedAssistantId,
    setSelectedAssistant,
    setModels,
    setSelectedAssistantId,
    clearSelectedAssistantId,
    setMessages,
    clearAttachments,
    isLoading,
    errorMessage,
    statusCode,
    statusMeta,
    resetSession,
    setSessionId,
    setGlobalLoading,
  } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      selectedAssistant: state.selectedAssistant,
      models: state.models,
      selectedAssistantId: state.selectedAssistantId,
      setSelectedAssistant: state.setSelectedAssistant,
      setModels: state.setModels,
      setSelectedAssistantId: state.setSelectedAssistantId,
      clearSelectedAssistantId: state.clearSelectedAssistantId,
      setMessages: state.setMessages,
      clearAttachments: state.clearAttachments,
      isLoading: state.isLoading,
      errorMessage: state.errorMessage,
      statusCode: state.statusCode,
      statusMeta: state.statusMeta,
      resetSession: state.resetSession,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
    }))
  );

  // 从 selectedAssistant 派生 assistant 模板列表
  const assistantTemplates: ChatAssistant[] = selectedAssistant ? [selectedAssistant] : [];
  const setAssistantTemplates = (nextTemplates: ChatAssistant[]) => {
    if (nextTemplates.length > 0) setSelectedAssistant(nextTemplates[0]);
  };
  const setSelectedTemplateId = setSelectedAssistantId;

  const { models: serviceModels, modelGroups: serviceModelGroups } = useChatService({
    enabled: true,
    modelCapability: "chat",
    fetchAssistants: false,
  });

  const isTauriRuntime = detectTauriRuntime();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const warm = () => {
      preloadHudDeferredSurfaces();
    };

    const browserWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
        cancelIdleCallback?: (handle: number) => void
      }

    if (typeof browserWindow.requestIdleCallback === 'function') {
      const id = browserWindow.requestIdleCallback(warm, { timeout: 1500 });
      return () => browserWindow.cancelIdleCallback?.(id);
    }

    const timeoutId = globalThis.setTimeout(warm, 1200);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    setModels(serviceModels);
  }, [serviceModels, setModels]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    if (!selectedAssistantId && assistantTemplates.length) {
      setSelectedTemplateId(assistantTemplates[0].id);
    }
  }, [isTauriRuntime, selectedAssistantId, assistantTemplates, setSelectedTemplateId]);

  useEffect(() => {
    if (!models.length) return;
    const exists = models.some((model) => model.id === config.model || model.provider_model_id === config.model);
    if (!exists) {
      setConfig({ model: resolveChatModelSelectionValue(models[0]) });
    }
  }, [config.model, models, setConfig]);

  const activeModelSource = models;
  const activeModelId = config.model;
  const activeModel =
    activeModelSource.find((model) => model.provider_model_id === activeModelId || model.id === activeModelId) ??
    activeModelSource[0];
  const activeModelVisual = resolveModelVisual(activeModel as any, {
    healthStatus: activeModel?.health_status ?? null,
    statusCode,
    isLoading,
    hasError: Boolean(errorMessage),
  });
  const statusDetail = resolveStatusDetail(t, statusCode, statusMeta);
  
  const activeTemplate = useMemo(() => 
    assistantTemplates.find((template) => template.id === selectedAssistantId), 
  [assistantTemplates, selectedAssistantId]);

  // 使用 useCallback 缓存事件处理函数
  const handleNewChat = useCallback(async () => {
     resetSession();
     setMessages([]);
     clearAttachments();
     if (!isTauriRuntime) {
       clearSelectedAssistantId();
     }
     const targetAssistantId = selectedAssistantId ?? assistantTemplates[0]?.id ?? undefined;
     setGlobalLoading(true);
     try {
      const created = await createConversation(
        isTauriRuntime ? { assistant_id: targetAssistantId ?? null } : {}
      );
       if (created.session_id) {
         setSessionId(created.session_id);
         if (typeof window !== "undefined") {
           const params = new URLSearchParams(searchParams?.toString());
          params.set("session", created.session_id);
          params.delete("agentId");
          const basePath =
            isTauriRuntime && targetAssistantId ? `/chat/${targetAssistantId}` : "/chat";
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
    clearSelectedAssistantId,
    searchParams,
    pathname,
    selectedAssistantId,
    assistantTemplates,
    setSessionId,
    setGlobalLoading,
    isTauriRuntime,
  ]);

  const handleToggleControlCenter = useCallback(() => {
    setIsControlCenterOpen(prev => !prev);
  }, []);

  const handleToggleMenu = useCallback(() => {
    setIsMenuOpen(prev => !prev);
  }, []);

  const handleOpenHistory = useCallback(() => {
    setIsHistoryOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setIsHistoryOpen(false);
  }, []);

  const handleThemeToggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  const handleModelChange = useCallback((value: string) => {
    setConfig({ model: value });
  }, [setConfig]);

  return (
    <>
    <nav className="flex flex-col items-center gap-2.5 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700 pointer-events-auto relative z-50">
      
      {/* 1. Minimal Status Capsule (The "Dynamic Island") */}
      <motion.div 
        layout
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-[999px] border border-white/70 dark:border-white/10 bg-white/70 dark:bg-black/40 backdrop-blur-2xl shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)] ring-1 ring-white/40 dark:ring-white/5 transition-all duration-500 relative z-50 group"
      >
          
          {/* Agent/Model Pulse Indicator */}
          <div
            onClick={handleToggleControlCenter}
            className="flex items-center gap-2 cursor-pointer transition-all hover:scale-[1.02]"
          >
            <div className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeModelVisual.indicator}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeModelVisual.indicator}`}></span>
            </div>
            <div className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-semibold text-slate-500/80 dark:text-white/50 uppercase tracking-[0.08em]">
                  {t("model.label")}
                </span>
                <span className="text-[12px] font-semibold text-slate-800 dark:text-white/90 flex items-center gap-1 tracking-tight">
                    {activeModel?.id ?? ""}
                    <ChevronDown className={`w-3 h-3 text-slate-400/90 dark:text-white/30 transition-transform duration-300 ${isControlCenterOpen ? 'rotate-180' : ''}`} />
                </span>
            </div>
          </div>

          <span className="text-slate-200 dark:text-white/10 text-xs self-center h-4 w-px bg-current"></span>

          {/* Session Title (Center) */}
          <div 
             onClick={handleOpenHistory}
             className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/60 dark:bg-white/5 text-slate-700/90 dark:text-white/70 hover:text-slate-900 dark:hover:text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors cursor-pointer group/session"
          >
             <span className="text-[11px] font-medium truncate max-w-[120px]">{t("hud.sessionTitle")}</span>
             <div className="w-5 h-5 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] group-hover/session:bg-white/90 dark:group-hover/session:bg-white/15 transition-colors">
                <ChevronDown className="w-3 h-3 text-slate-400 dark:text-white/40 transition-transform group-hover/session:rotate-180" />
             </div>
             {isLoading && statusDetail ? (
               <StatusPill text={statusDetail} className="ml-1 max-w-[160px]" tone="subtle" isLoading />
             ) : null}
          </div>

          <span className="text-slate-200 dark:text-white/10 text-xs self-center h-4 w-px bg-current"></span>

          {/* System Menu Trigger (Right) */}
          <Button
            variant="ghost"
            onClick={handleToggleMenu}
            className={`
                p-1.5 rounded-full transition-all duration-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]
                ${isMenuOpen ? 'bg-slate-900 text-white dark:bg-white dark:text-black scale-[1.06] shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)]' : 'bg-white/60 dark:bg-white/5 text-slate-600 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-white/90 dark:hover:bg-white/10'}
            `}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>

      </motion.div>

      {/* 2. Control Center (Model Config) */}
      <AnimatePresence>
        {isControlCenterOpen && (
            <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute top-full mt-3 w-80 bg-[#F7F9FB]/85 dark:bg-[#0b0c0e]/88 backdrop-blur-2xl border border-white/70 dark:border-white/10 rounded-[2rem] shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)] ring-1 ring-white/40 dark:ring-white/5 overflow-hidden p-4 flex flex-col gap-4 z-50"
            >
                <DeferredHudControlCenterPanel
                  value={activeModelId ?? ""}
                  onChange={handleModelChange}
                  modelGroups={serviceModelGroups}
                  title={t("model.label")}
                  subtitle={t("model.placeholder")}
                  searchPlaceholder={t("model.searchPlaceholder")}
                  emptyText={t("error.modelUnavailable")}
                  noResultsText={t("model.noResults")}
                  disabled={false}
                />
            </motion.div>
        )}
      </AnimatePresence>

      {/* 3. System Dropdown (Existing) */}
      <AnimatePresence>
        {isMenuOpen && (
            <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute top-full mt-3 w-64 bg-white/82 dark:bg-[#121212]/88 backdrop-blur-2xl border border-white/70 dark:border-white/10 rounded-[1.75rem] shadow-[0_18px_40px_-20px_rgba(15,23,42,0.35)] ring-1 ring-white/40 dark:ring-white/5 overflow-hidden p-3 flex flex-col gap-2 z-50"
            >
                <DeferredHudSystemMenuPanel
                  homeLabel={t("hud.menu.home")}
                  dashboardLabel={t("hud.menu.dashboard")}
                  registryLabel={t("hud.menu.registry")}
                  preferencesLabel={t("hud.menu.preferences")}
                  interfaceModeLabel={t("hud.menu.interfaceMode")}
                  terminateSessionLabel={t("hud.menu.terminateSession")}
                  theme={theme}
                  onThemeToggle={handleThemeToggle}
                  logoutHref={`/login?callbackUrl=${encodeURIComponent(pathname || "/")}`}
                />
            </motion.div>
        )}
      </AnimatePresence>

    </nav>
    
    <DeferredHistorySidebar isOpen={isHistoryOpen} onClose={handleCloseHistory} />
    </>
  );
}
