'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HudActivityBar } from './hud-activity-bar';
import { useChatStore } from '@/store/chat-store';
import { useChatRuntimeStore } from '@/store/chat-runtime-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatModels } from '@/hooks/use-chat-models';
import { useI18n } from '@/hooks/use-i18n';
import { resolveChatModelSelectionValue } from '@/lib/api/models';
import {
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
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const t = useI18n('chat');
  
  const { config, setConfig, models, setModels } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      models: state.models,
      setModels: state.setModels,
    }))
  );
  const sessionTitle = useChatRuntimeStore((state) => state.sessionTitle);

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
  const handleToggleControlCenter = useCallback(() => {
    setIsControlCenterOpen(prev => !prev);
  }, []);

  const handleModelChange = useCallback((value: string) => {
    setConfig({ model: value });
  }, [setConfig]);

  return (
    <>
    <nav className="pointer-events-auto relative z-50 flex flex-col items-center gap-1.5 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700">
      
      {/* 1. Minimal Status Capsule (The "Dynamic Island") */}
      <motion.div 
        layout
        className="group relative z-50 flex min-h-[58px] items-center gap-4 rounded-[999px] border border-white/70 bg-white/80 px-5 py-2.5 shadow-[0_18px_58px_-48px_rgba(87,93,176,0.54),inset_0_1px_0_rgba(255,255,255,0.92)] ring-1 ring-white/60 backdrop-blur-2xl transition-all duration-500 dark:border-white/10 dark:bg-zinc-950/45 dark:ring-white/10"
      >
          
          {/* Model selector */}
          <div
            onClick={handleToggleControlCenter}
            className="flex cursor-pointer items-center gap-2.5 transition-all hover:scale-[1.01]"
          >
            <div className="flex flex-col items-start leading-none">
                <span className="text-[11px] font-semibold leading-3 text-slate-500/90 dark:text-white/50">
                  {t("model.label")}
                </span>
                <span className="mt-0.5 flex max-w-[160px] items-center gap-1.5 truncate text-[15px] font-semibold leading-5 tracking-tight text-slate-800 dark:text-white/90">
                    {activeModel?.id ?? ""}
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400/90 transition-transform duration-300 dark:text-white/30 ${isControlCenterOpen ? 'rotate-180' : ''}`} />
                </span>
            </div>
          </div>

          <span className="h-7 w-px self-center bg-slate-200/80 text-xs text-slate-200 dark:bg-white/10 dark:text-white/10"></span>

          {/* Session Title (Center) */}
          <div className="group/session flex items-center gap-1.5 rounded-full bg-transparent px-0 py-1 text-slate-700/90 transition-colors dark:text-white/70">
             <span className="max-w-[170px] truncate text-[15px] font-semibold leading-5 tracking-tight">
               {sessionTitle?.trim() || t("hud.sessionTitle")}
             </span>
          </div>

          <HudActivityBar />

      </motion.div>

      {/* 3. Control Center (Model Config) */}
      <AnimatePresence>
        {isControlCenterOpen && (
            <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute top-full mt-3 w-80 bg-[#F7F9FB]/85 dark:bg-[#0b0c0e]/90 backdrop-blur-2xl border border-white/70 dark:border-white/10 rounded-[2rem] shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)] ring-1 ring-white/40 dark:ring-white/5 overflow-hidden p-4 flex flex-col gap-4 z-50"
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

    </>
  );
}
