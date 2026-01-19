'use client';
import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, Settings, Sun, Moon, Bot, Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { HistorySidebar } from '../components/history-sidebar';
import { useChatStore } from '@/store/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatService } from '@/hooks/use-chat-service';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { ModelPicker, resolveModelVisual } from '@/components/models/model-picker';
import { resolveStatusDetail } from '@/lib/chat/status-detail';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

export default function HUD() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const t = useI18n('chat');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
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
    loadHistory,
    isLoading,
    statusCode,
    statusMeta,
    resetSession
  } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      assistants: state.assistants,
      models: state.models,
      activeAssistantId: state.activeAssistantId,
      setAssistants: state.setAssistants,
      setModels: state.setModels,
      setActiveAssistantId: state.setActiveAssistantId,
      loadHistory: state.loadHistory,
      isLoading: state.isLoading,
      statusCode: state.statusCode,
      statusMeta: state.statusMeta,
      resetSession: state.resetSession
    }))
  );

  const { assistants: serviceAssistants, models: serviceModels, modelGroups: serviceModelGroups } = useChatService({ enabled: true });

  useEffect(() => {
    if (serviceAssistants.length) {
      setAssistants(serviceAssistants);
    }
  }, [serviceAssistants, setAssistants]);

  useEffect(() => {
    setModels(serviceModels);
  }, [serviceModels, setModels]);

  useEffect(() => {
    if (!activeAssistantId && assistants.length) {
      setActiveAssistantId(assistants[0].id);
    }
  }, [activeAssistantId, assistants, setActiveAssistantId]);

  useEffect(() => {
    if (!models.length) return;
    const exists = models.some((model) => model.id === config.model || model.provider_model_id === config.model);
    if (!exists) {
      setConfig({ model: models[0].provider_model_id ?? models[0].id });
    }
  }, [config.model, models, setConfig]);

  useEffect(() => {
    if (!activeAssistantId) return;
    void loadHistory(activeAssistantId);
  }, [activeAssistantId, loadHistory]);

  const activeModel =
    models.find((model) => model.provider_model_id === config.model || model.id === config.model) ?? models[0];
  const activeModelVisual = resolveModelVisual(activeModel);
  const statusDetail = resolveStatusDetail(t, statusCode, statusMeta);
  
  const activeAssistant = useMemo(() => 
    assistants.find(a => a.id === activeAssistantId), 
  [assistants, activeAssistantId]);

  const handleNewChat = () => {
     resetSession();
     const params = new URLSearchParams(searchParams?.toString());
     params.delete("session");
     const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
     router.replace(url || "/chat");
  };

  return (
    <>
    <nav className="flex flex-col items-center gap-2 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700 pointer-events-auto relative z-50">
      
      {/* 1. Minimal Status Capsule (The "Dynamic Island") */}
      <motion.div 
        layout
        className="flex items-center gap-3 px-4 py-2 rounded-full border border-slate-200/70 dark:border-white/5 bg-white/90 dark:bg-black/20 backdrop-blur-md shadow-sm dark:shadow-none transition-all duration-500 relative z-50 group"
      >
          
          {/* Agent/Model Pulse Indicator */}
          <div
            onClick={() => setIsControlCenterOpen(!isControlCenterOpen)}
            className="flex items-center gap-2 cursor-pointer transition-all hover:scale-105"
          >
            <div className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeModelVisual.indicator}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeModelVisual.indicator}`}></span>
            </div>
            <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-tighter">
                  {t("model.label")}
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                    {activeModel?.id ?? ""}
                    <ChevronDown className={`w-3 h-3 text-slate-500 dark:text-white/30 transition-transform duration-300 ${isControlCenterOpen ? 'rotate-180' : ''}`} />
                </span>
            </div>
          </div>

          <span className="text-slate-300 dark:text-white/10 text-xs self-center h-4 w-[1px] bg-current"></span>

          {/* Session Title (Center) */}
          <div 
             onClick={() => setIsHistoryOpen(true)}
             className="flex items-center gap-2 text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer group/session"
          >
             <span className="text-xs font-semibold truncate max-w-[120px]">{t("hud.sessionTitle")}</span>
             <div className="w-5 h-5 rounded-md bg-slate-100/80 dark:bg-white/5 flex items-center justify-center group-hover/session:bg-slate-200/70 dark:group-hover/session:bg-white/10 transition-colors">
                <ChevronDown className="w-3 h-3 text-slate-500 dark:text-white/30 transition-transform group-hover/session:rotate-180" />
             </div>
             {isLoading && statusDetail ? (
               <StatusPill text={statusDetail} className="ml-1 max-w-[160px]" tone="subtle" isLoading />
             ) : null}
          </div>

          <span className="text-slate-300 dark:text-white/10 text-xs self-center h-4 w-[1px] bg-current"></span>

          {/* System Menu Trigger (Right) */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`
                p-1.5 rounded-full transition-all duration-300
                ${isMenuOpen ? 'bg-slate-900 text-white dark:bg-white dark:text-black scale-110' : 'text-slate-600 dark:text-white/40 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/5'}
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
                className="absolute top-full mt-3 w-80 bg-[#F7F9FB]/95 dark:bg-[#0b0c0e]/92 backdrop-blur-2xl border border-slate-200/70 dark:border-white/10 rounded-[2.25rem] shadow-[0_20px_50px_-18px_rgba(15,23,42,0.35),0_8px_20px_-12px_rgba(37,99,235,0.18)] overflow-hidden p-4 flex flex-col gap-4 z-50"
            >
                <ModelPicker
                  value={config.model}
                  onChange={(value) => setConfig({ model: value })}
                  modelGroups={serviceModelGroups}
                  title={t("model.label")}
                  subtitle={t("model.placeholder")}
                  searchPlaceholder={t("model.searchPlaceholder")}
                  emptyText={t("error.modelUnavailable")}
                  noResultsText={t("model.noResults")}
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
                className="absolute top-full mt-3 w-64 bg-white/92 dark:bg-[#121212]/90 backdrop-blur-xl border border-slate-200/70 dark:border-white/5 rounded-[2rem] shadow-2xl overflow-hidden p-3 flex flex-col gap-2 z-50"
            >
                <div className="flex items-center gap-3 p-2 mb-1 border-b border-slate-200/70 dark:border-white/5 pb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-inner">
                        AD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-900 dark:text-white/90">{t("hud.system.userName")}</span>
                        <span className="text-[10px] font-medium text-slate-500 dark:text-white/40 italic">
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
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="flex items-center justify-between p-3 rounded-2xl bg-slate-100/70 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors text-[11px] font-bold"
                     >
                        <div className="flex items-center gap-3">
                            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            <span>{t("hud.menu.interfaceMode")}</span>
                        </div>
                        <span className="text-[9px] opacity-40 uppercase">{theme}</span>
                     </button>
                     
                     <Link href="/login" className="flex items-center gap-3 p-3 rounded-2xl hover:bg-red-500/10 hover:text-red-500 transition-colors text-[11px] font-bold">
                        <LogOut className="w-4 h-4" />
                        <span>{t("hud.menu.terminateSession")}</span>
                     </Link>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

    </nav>
    
    <HistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}

function MenuLink({ href, icon, label }: any) {
    return (
        <Link href={href} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-slate-100/70 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 transition-all group border border-transparent hover:border-slate-200/70 dark:hover:border-white/10">
            <div className="text-slate-500 dark:text-white/40 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                {icon}
            </div>
            <span className="text-[9px] font-black text-slate-500 dark:text-white/40 uppercase tracking-tighter group-hover:text-slate-700 dark:group-hover:text-white/80">{label}</span>
        </Link>
    )
}
