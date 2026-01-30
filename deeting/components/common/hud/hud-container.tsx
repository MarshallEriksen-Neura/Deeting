'use client';

import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, Settings, Sun, Moon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { usePathname, useSearchParams } from 'next/navigation';
import { HistorySidebar } from '@/components/chat/sidebar/history-sidebar';
import { ImageHistorySidebar } from '@/components/image/history/image-history-sidebar';
import { useChatStateStore } from '@/store/chat-state-store';
import { useChatSessionStore } from '@/store/chat-session-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatService } from '@/hooks/use-chat-service';
import { useI18n } from '@/hooks/use-i18n';
import { ModelPicker, resolveModelVisual } from '@/components/models/model-picker';
import { resolveStatusDetail } from '@/lib/chat/status-detail';
import { StatusPill } from '@/components/ui/status-pill';
import { useImageGenerationStore } from '@/store/image-generation-store';
import { createConversation } from '@/lib/api/conversations';

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
  const isImage = pathname?.includes('/create/image');
  
  const { setTheme, theme } = useTheme();
  
  const {
    config,
    setConfig,
    assistants,
    models,
    activeAssistantId,
    setAssistants,
    setModels,
    setActiveAssistantId,
    setMessages,
    clearAttachments,
  } = useChatStateStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      assistants: state.assistants,
      models: state.models,
      activeAssistantId: state.activeAssistantId,
      setAssistants: state.setAssistants,
      setModels: state.setModels,
      setActiveAssistantId: state.setActiveAssistantId,
      setMessages: state.setMessages,
      clearAttachments: state.clearAttachments,
    }))
  );

  const {
    isLoading,
    statusCode,
    statusMeta,
    resetSession,
    setSessionId,
    setGlobalLoading,
  } = useChatSessionStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      statusCode: state.statusCode,
      statusMeta: state.statusMeta,
      resetSession: state.resetSession,
      setSessionId: state.setSessionId,
      setGlobalLoading: state.setGlobalLoading,
    }))
  );

  const { assistants: serviceAssistants, models: serviceModels, modelGroups: serviceModelGroups } = useChatService({
    enabled: !isImage,
  });
  const {
    models: imageModels,
    modelGroups: imageModelGroups,
    isLoadingModels: isLoadingImageModels,
  } = useChatService({
    enabled: isImage,
    modelCapability: "image_generation",
  });
  const { selectedModelId, setSelectedModelId } = useImageGenerationStore();

  useEffect(() => {
    if (isImage) return;
    if (serviceAssistants.length) {
      setAssistants(serviceAssistants);
    }
  }, [isImage, serviceAssistants, setAssistants]);

  useEffect(() => {
    if (isImage) return;
    setModels(serviceModels);
  }, [isImage, serviceModels, setModels]);

  useEffect(() => {
    if (!activeAssistantId && assistants.length) {
      setActiveAssistantId(assistants[0].id);
    }
  }, [activeAssistantId, assistants, setActiveAssistantId]);

  useEffect(() => {
    if (isImage || !models.length) return;
    const exists = models.some((model) => model.id === config.model || model.provider_model_id === config.model);
    if (!exists) {
      setConfig({ model: models[0].provider_model_id ?? models[0].id });
    }
  }, [config.model, isImage, models, setConfig]);

  useEffect(() => {
    if (!isImage || !imageModels.length) return;
    const exists = imageModels.some(
      (model) => model.id === selectedModelId || model.provider_model_id === selectedModelId
    );
    if (!exists) {
      setSelectedModelId(imageModels[0].provider_model_id ?? imageModels[0].id);
    }
  }, [imageModels, isImage, selectedModelId, setSelectedModelId]);

  const activeModelSource = isImage ? imageModels : models;
  const activeModelId = isImage ? selectedModelId : config.model;
  const activeModel =
    activeModelSource.find((model) => model.provider_model_id === activeModelId || model.id === activeModelId) ??
    activeModelSource[0];
  const activeModelVisual = resolveModelVisual(activeModel);
  const statusDetail = resolveStatusDetail(t, statusCode, statusMeta);
  
  const activeAssistant = useMemo(() => 
    assistants.find(a => a.id === activeAssistantId), 
  [assistants, activeAssistantId]);

  const isTauriRuntime = useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  );

  // 使用 useCallback 缓存事件处理函数
  const handleNewChat = useCallback(async () => {
     resetSession();
     setMessages([]);
     clearAttachments();
     if (typeof window !== "undefined" && activeAssistantId) {
       localStorage.removeItem(`deeting-chat-session:${activeAssistantId}`);
     }
     const targetAssistantId = activeAssistantId ?? assistants[0]?.id ?? undefined;
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
    searchParams,
    pathname,
    activeAssistantId,
    assistants,
    setSessionId,
    setGlobalLoading,
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
    if (isImage) {
      setSelectedModelId(value);
      return;
    }
    setConfig({ model: value });
  }, [isImage, setSelectedModelId, setConfig]);

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
          <button 
            onClick={handleToggleMenu}
            className={`
                p-1.5 rounded-full transition-all duration-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]
                ${isMenuOpen ? 'bg-slate-900 text-white dark:bg-white dark:text-black scale-[1.06] shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)]' : 'bg-white/60 dark:bg-white/5 text-slate-600 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-white/90 dark:hover:bg-white/10'}
            `}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>

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
                <ModelPicker
                  value={activeModelId ?? ""}
                  onChange={handleModelChange}
                  modelGroups={isImage ? imageModelGroups : serviceModelGroups}
                  title={t("model.label")}
                  subtitle={t("model.placeholder")}
                  searchPlaceholder={t("model.searchPlaceholder")}
                  emptyText={t("error.modelUnavailable")}
                  noResultsText={t("model.noResults")}
                  disabled={isImage ? isLoadingImageModels : false}
                />

                <div className="flex items-center justify-center pb-1">
                    <div className="w-12 h-1 rounded-full bg-slate-200/70 dark:bg-white/10" />
                </div>
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
                <div className="flex items-center gap-3 p-2 mb-1 border-b border-slate-200/70 dark:border-white/5 pb-3">
                    <div className="w-10 h-10 rounded-full bg-slate-900/90 dark:bg-white/80 flex items-center justify-center text-white dark:text-black text-xs font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]">
                        AD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white/90">{t("hud.system.userName")}</span>
                        <span className="text-[10px] font-medium text-slate-500/90 dark:text-white/40 italic">
                          {t("hud.system.integrity", { value: "100%" })}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <MenuLink href="/" icon={<Home className="w-4 h-4" />} label={t("hud.menu.home")} />
                    <MenuLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label={t("hud.menu.dashboard")} />
                    <MenuLink href="/market" icon={<ShoppingBag className="w-4 h-4" />} label={t("hud.menu.registry")} />
                    <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />} label={t("hud.menu.preferences")} />
                </div>

                <div className="flex flex-col gap-1 mt-1">
                     <button 
                        onClick={handleThemeToggle}
                        className="flex items-center justify-between p-3 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10 transition-colors text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                     >
                        <div className="flex items-center gap-3">
                            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            <span>{t("hud.menu.interfaceMode")}</span>
                        </div>
                        <span className="text-[9px] opacity-40 uppercase">{theme}</span>
                     </button>
                     
                     <Link href={`/login?callbackUrl=${encodeURIComponent(pathname || "/")}`} className="flex items-center gap-3 p-3 rounded-2xl bg-white/60 dark:bg-white/5 hover:bg-red-500/10 hover:text-red-500 transition-colors text-[11px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                        <LogOut className="w-4 h-4" />
                        <span>{t("hud.menu.terminateSession")}</span>
                     </Link>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

    </nav>
    
    {isImage ? (
      <ImageHistorySidebar isOpen={isHistoryOpen} onClose={handleCloseHistory} />
    ) : (
      <HistorySidebar isOpen={isHistoryOpen} onClose={handleCloseHistory} />
    )}
    </>
  );
}

function MenuLink({ href, icon, label }: any) {
    return (
        <Link href={href} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/70 dark:bg-white/5 hover:bg-white/90 dark:hover:bg-white/10 transition-all group shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="text-slate-500/90 dark:text-white/45 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                {icon}
            </div>
            <span className="text-[9px] font-semibold text-slate-500/90 dark:text-white/40 uppercase tracking-[0.08em] group-hover:text-slate-700 dark:group-hover:text-white/80">{label}</span>
        </Link>
    )
}
