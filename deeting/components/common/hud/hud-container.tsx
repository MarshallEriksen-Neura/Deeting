'use client';

import { ChevronDown, FilePenLine, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatModels } from '@/hooks/use-chat-models';
import { useI18n } from '@/hooks/use-i18n';
import { resolveChatModelSelectionValue } from '@/lib/api/models';
import { resolveModelVisual, type ModelPickerModel } from '@/components/models/model-visual';
import { formatContextWindow } from '@/components/models/types';
import { isTauriRuntime as detectTauriRuntime } from '@/lib/runtime/tauri';
import { DESKTOP_CONFIG_KEYS, getDesktopConfig, setDesktopConfig } from '@/lib/api/desktop-config';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import {
  DeferredHistorySidebar,
  DeferredHudControlCenterPanel,
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [isPersonaDialogOpen, setIsPersonaDialogOpen] = useState(false);
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [savedPersonaPrompt, setSavedPersonaPrompt] = useState('');
  const [isPersonaLoading, setIsPersonaLoading] = useState(false);
  const [isPersonaSaving, setIsPersonaSaving] = useState(false);
  const t = useI18n('chat');
  const isTauriRuntime = detectTauriRuntime();
  
  const { config, setConfig, models, setModels } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      models: state.models,
      setModels: state.setModels,
    }))
  );
  const { isLoading, errorMessage, statusCode, sessionTitle, sessionUsage } = useChatRuntimeStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      errorMessage: state.errorMessage,
      statusCode: state.statusCode,
      sessionTitle: state.sessionTitle,
      sessionUsage: state.sessionUsage,
    }))
  );

  const { models: serviceModels, modelGroups: serviceModelGroups } = useChatModels({
    enabled: true,
    modelCapability: "chat",
  });

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
  const activeModelVisualSource: ModelPickerModel | undefined = activeModel
    ? {
        id: activeModel.id,
        owned_by: activeModel.owned_by,
        provider_model_id: activeModel.provider_model_id ?? undefined,
        health_status: activeModel.health_status,
        is_platform: activeModel.is_platform,
        pricing: activeModel.pricing,
      }
    : undefined;
  const activeModelVisual = resolveModelVisual(activeModelVisualSource, {
    healthStatus: activeModel?.health_status ?? null,
    statusCode,
    isLoading,
    hasError: Boolean(errorMessage),
  });

  // Derive context window usage
  const contextWindowLimit = activeModel?.context_window ?? 0
  const contextUsed = sessionUsage?.contextWindowUsed ?? 0
  const usagePercent = contextWindowLimit > 0 ? Math.min(100, Math.round((contextUsed / contextWindowLimit) * 100)) : 0
  const usageLabel = contextWindowLimit > 0
    ? `${formatContextWindow(contextUsed)}/${formatContextWindow(contextWindowLimit)}`
    : null
  const usageTone = usagePercent >= 85 ? 'danger' : usagePercent >= 60 ? 'warn' : 'normal'

  const handleToggleControlCenter = useCallback(() => {
    setIsControlCenterOpen(prev => !prev);
  }, []);

  const handleOpenHistory = useCallback(() => {
    setIsHistoryOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setIsHistoryOpen(false);
  }, []);

  const handleOpenPersonaDialog = useCallback(async () => {
    if (!isTauriRuntime || isPersonaLoading) return;

    setIsPersonaDialogOpen(true);
    setIsPersonaLoading(true);

    try {
      const currentValue = (await getDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt))?.trim() ?? '';
      setPersonaPrompt(currentValue);
      setSavedPersonaPrompt(currentValue);
    } catch (error) {
      console.warn('load_persona_prompt_failed', error);
      toast.error(t('hud.personaPrompt.toast.loadFailed'));
    } finally {
      setIsPersonaLoading(false);
    }
  }, [isPersonaLoading, isTauriRuntime, t]);

  const handlePersonaDialogOpenChange = useCallback((open: boolean) => {
    if (!open && isPersonaSaving) return;
    setIsPersonaDialogOpen(open);
  }, [isPersonaSaving]);

  const handleSavePersonaPrompt = useCallback(async () => {
    if (!isTauriRuntime) return;

    const nextValue = personaPrompt.trim();
    setIsPersonaSaving(true);

    try {
      await setDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt, nextValue);
      setPersonaPrompt(nextValue);
      setSavedPersonaPrompt(nextValue);
      setIsPersonaDialogOpen(false);
      toast.success(t('hud.personaPrompt.toast.saveSuccess'));
    } catch (error) {
      console.warn('save_persona_prompt_failed', error);
      toast.error(t('hud.personaPrompt.toast.saveFailed'));
    } finally {
      setIsPersonaSaving(false);
    }
  }, [isTauriRuntime, personaPrompt, t]);

  const handleModelChange = useCallback((value: string) => {
    setConfig({ model: value });
  }, [setConfig]);

  const handleExitToHome = useCallback(() => {
    window.location.assign('/');
  }, []);

  const personaPromptDirty = personaPrompt.trim() !== savedPersonaPrompt;

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
          <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-full bg-white/60 dark:bg-white/5 text-slate-700/90 dark:text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors group/session">
             <button
               type="button"
               onClick={handleOpenHistory}
               className="flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors hover:text-slate-900 dark:hover:text-white"
               aria-label={t("history.title")}
             >
               <span className="truncate max-w-[120px]">{sessionTitle?.trim() || t("hud.sessionTitle")}</span>
             </button>
             <button
               type="button"
               onClick={handleOpenHistory}
               className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70 dark:bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-colors group-hover/session:bg-white/90 dark:group-hover/session:bg-white/15"
               aria-label={t("history.title")}
             >
               <ChevronDown className="w-3 h-3 text-slate-400 dark:text-white/40 transition-transform group-hover/session:rotate-180" />
             </button>
             {isTauriRuntime ? (
               <button
                 type="button"
                 onClick={() => {
                   void handleOpenPersonaDialog();
                 }}
                 className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] transition-colors hover:bg-white/90 hover:text-slate-900 dark:bg-white/10 dark:text-white/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] dark:hover:bg-white/15 dark:hover:text-white"
                 aria-label={t("hud.personaPrompt.trigger")}
                 title={t("hud.personaPrompt.trigger")}
               >
                 <FilePenLine className="h-3 w-3" />
                 <span>{t("hud.personaPrompt.button")}</span>
               </button>
             ) : null}
          </div>

          <span className="text-slate-200 dark:text-white/10 text-xs self-center h-4 w-px bg-current"></span>

          {/* Context Window Usage Indicator */}
          {usageLabel ? (
            <span
              className={`text-[10px] font-medium tabular-nums tracking-wide transition-colors duration-300 ${
                usageTone === 'danger'
                  ? 'text-red-400'
                  : usageTone === 'warn'
                    ? 'text-amber-400'
                    : 'text-slate-400/70 dark:text-white/30'
              }`}
              title={`Context: ${usagePercent}% used`}
            >
              {usageLabel}
            </span>
          ) : null}

          <span className="text-slate-200 dark:text-white/10 text-xs self-center h-4 w-px bg-current"></span>

          {/* Exit Trigger (Right) */}
          <Button
            variant="ghost"
            onClick={() => {
              handleExitToHome();
            }}
            aria-label={t("hud.menu.home")}
            className={`
                p-1.5 rounded-full transition-all duration-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]
                bg-white/60 dark:bg-white/5 text-slate-600 dark:text-white/50 hover:text-red-500 dark:hover:text-red-400 hover:bg-white/90 dark:hover:bg-white/10
            `}
          >
            <LogOut className="w-4 h-4" />
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
    </nav>

    <Dialog open={isPersonaDialogOpen} onOpenChange={handlePersonaDialogOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border-white/20 dark:border-white/10">
        <DialogHeader>
          <DialogTitle>{t('hud.personaPrompt.title')}</DialogTitle>
          <DialogDescription>{t('hud.personaPrompt.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={personaPrompt}
            onChange={(event) => setPersonaPrompt(event.target.value)}
            disabled={isPersonaLoading || isPersonaSaving}
            placeholder={t('hud.personaPrompt.placeholder')}
            className="min-h-40 rounded-2xl border-border/60 bg-background/80"
          />
          <p className="text-xs text-muted-foreground">
            {t('hud.personaPrompt.help')}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsPersonaDialogOpen(false)}
            disabled={isPersonaSaving}
          >
            {t('hud.personaPrompt.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSavePersonaPrompt();
            }}
            disabled={isPersonaLoading || isPersonaSaving || !personaPromptDirty}
          >
            {isPersonaSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('hud.personaPrompt.saving')}
              </>
            ) : (
              t('hud.personaPrompt.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <DeferredHistorySidebar isOpen={isHistoryOpen} onClose={handleCloseHistory} />
    </>
  );
}
