'use client';
import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, Settings, Sun, Moon, Cpu, Zap, Check, Search } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { HistorySidebar } from '../components/history-sidebar';
import { useChatStore } from '@/store/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { useChatService } from '@/hooks/use-chat-service';
import type { ModelInfo } from '@/lib/api/models';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';

type ModelVisual = {
  icon: typeof Cpu;
  color: string;
  indicator: string;
};

function resolveModelVisual(model?: ModelInfo): ModelVisual {
  const ownedBy = model?.owned_by?.toLowerCase() ?? "";
  if (ownedBy.includes("openai")) {
    return { icon: Zap, color: "text-emerald-500", indicator: "bg-emerald-500" };
  }
  if (ownedBy.includes("anthropic") || ownedBy.includes("claude")) {
    return { icon: Cpu, color: "text-orange-500", indicator: "bg-orange-500" };
  }
  if (ownedBy.includes("deepseek")) {
    return { icon: Cpu, color: "text-blue-500", indicator: "bg-blue-500" };
  }
  return { icon: Cpu, color: "text-black/40 dark:text-white/40", indicator: "bg-black/30 dark:bg-white/30" };
}

export default function HUD() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const t = useI18n('chat');
  
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
    }))
  );

  const { assistants: serviceAssistants, models: serviceModels, modelGroups: serviceModelGroups } = useChatService({ enabled: true });

  const filteredModelGroups = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return serviceModelGroups;
    return serviceModelGroups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => {
          const name = model.id?.toLowerCase() ?? '';
          const ownedBy = model.owned_by?.toLowerCase() ?? '';
          const providerId = model.provider_model_id?.toLowerCase() ?? '';
          return name.includes(query) || ownedBy.includes(query) || providerId.includes(query);
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [modelQuery, serviceModelGroups]);

  const filteredModelCount = useMemo(
    () => filteredModelGroups.reduce((sum, group) => sum + group.models.length, 0),
    [filteredModelGroups]
  );

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

  return (
    <>
    <nav className="flex flex-col items-center gap-2 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700 pointer-events-auto relative z-50">
      
      {/* 1. Minimal Status Capsule (The "Dynamic Island") */}
      <motion.div 
        layout
        className="flex items-center gap-3 px-4 py-2 rounded-full border border-black/5 dark:border-white/5 bg-white/70 dark:bg-black/20 backdrop-blur-md shadow-sm dark:shadow-none transition-all duration-500 relative z-50 group"
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
                <span className="text-[10px] font-bold text-black/40 dark:text-white/40 uppercase tracking-tighter">
                  {t("model.label")}
                </span>
                <span className="text-xs font-bold text-black dark:text-white flex items-center gap-1">
                    {activeModel?.id ?? ""}
                    <ChevronDown className={`w-3 h-3 text-black/30 dark:text-white/30 transition-transform duration-300 ${isControlCenterOpen ? 'rotate-180' : ''}`} />
                </span>
            </div>
          </div>

          <span className="text-black/10 dark:text-white/10 text-xs self-center h-4 w-[1px] bg-current"></span>

          {/* Session Title (Center) */}
          <div 
             onClick={() => setIsHistoryOpen(true)}
             className="flex items-center gap-1.5 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition-colors cursor-pointer group/session"
          >
             <span className="text-xs font-semibold truncate max-w-[120px]">{t("hud.sessionTitle")}</span>
             <div className="w-5 h-5 rounded-md bg-black/5 dark:bg-white/5 flex items-center justify-center group-hover/session:bg-black/10 dark:group-hover/session:bg-white/10 transition-colors">
                <ChevronDown className="w-3 h-3 text-black/30 dark:text-white/30 transition-transform group-hover/session:rotate-180" />
             </div>
          </div>

          <span className="text-black/10 dark:text-white/10 text-xs self-center h-4 w-[1px] bg-current"></span>

          {/* System Menu Trigger (Right) */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`
                p-1.5 rounded-full transition-all duration-300
                ${isMenuOpen ? 'bg-black text-white dark:bg-white dark:text-black scale-110' : 'text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}
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
                className="absolute top-full mt-3 w-80 bg-[#F7F9FB]/95 dark:bg-[#0b0c0e]/92 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-[2.25rem] shadow-[0_20px_50px_-18px_rgba(15,23,42,0.35),0_8px_20px_-12px_rgba(37,99,235,0.18)] overflow-hidden p-4 flex flex-col gap-4 z-50"
            >
                <div className="flex flex-col gap-3 rounded-[1.75rem] bg-white/80 dark:bg-white/5 border border-black/5 dark:border-white/10 p-4 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.3)]">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-black/55 dark:text-white/60 uppercase tracking-[0.2em]">
                        {t("model.label")}
                      </span>
                      <span className="text-[11px] text-black/40 dark:text-white/40">
                        {t("model.placeholder")}
                      </span>
                    </div>
                    <span className="rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-0.5 text-[10px] font-mono text-black/40 dark:text-white/40">
                      {filteredModelCount}
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30 dark:text-white/30" />
                    <Input
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      placeholder={t("model.searchPlaceholder")}
                      className="h-10 rounded-full border-0 bg-white/90 dark:bg-black/40 pl-9 text-[12px] font-medium text-black/80 dark:text-white/80 placeholder:text-black/30 dark:placeholder:text-white/30 shadow-[0_6px_16px_-12px_rgba(15,23,42,0.25)] focus-visible:ring-2 focus-visible:ring-blue-500/30"
                    />
                  </div>

                  {serviceModelGroups.length === 0 ? (
                    <div className="text-[11px] text-black/40 dark:text-white/40 px-1">
                      {t("error.modelUnavailable")}
                    </div>
                  ) : (
                    <ScrollArea className="max-h-72 pr-1">
                      <div className="space-y-3">
                        {filteredModelGroups.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-6 text-center text-[11px] text-black/40 dark:text-white/40">
                            {t("model.noResults")}
                          </div>
                        ) : (
                          filteredModelGroups.map((group) => (
                            <div
                              key={group.instance_id}
                              className="rounded-2xl bg-white/80 dark:bg-black/30 border border-black/5 dark:border-white/10 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.25)]"
                            >
                              <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-black/40 dark:text-white/40">
                                <span className="font-black">{group.instance_name}</span>
                                {group.provider && (
                                  <span className="text-[9px] font-semibold text-black/35 dark:text-white/35">
                                    {group.provider}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col gap-1.5 px-2 pb-2">
                                {group.models.map((model) => {
                                  const modelValue = model.provider_model_id ?? model.id;
                                  const isActive = config.model === modelValue || config.model === model.id;
                                  const visual = resolveModelVisual(model);
                                  const Icon = visual.icon;
                                  return (
                                    <Button
                                      key={modelValue}
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setConfig({ model: modelValue })}
                                      className={`h-11 justify-between rounded-xl px-3 text-[11px] font-semibold transition-colors ${
                                        isActive
                                          ? "bg-black/10 text-black dark:bg-white/10 dark:text-white ring-1 ring-blue-500/25"
                                          : "text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5"
                                      }`}
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 ${isActive ? "bg-white/80 dark:bg-black/60" : ""}`}>
                                          <Icon className={`h-3.5 w-3.5 ${visual.color}`} />
                                        </span>
                                        <span className="flex min-w-0 flex-col text-left leading-tight">
                                          <span className="truncate text-[11px] font-semibold">
                                            {model.id}
                                          </span>
                                          {model.owned_by ? (
                                            <span className="truncate text-[9px] text-black/35 dark:text-white/35">
                                              {model.owned_by}
                                            </span>
                                          ) : null}
                                        </span>
                                      </span>
                                      {isActive ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                                      ) : (
                                        <span className="h-2 w-2 rounded-full bg-black/10 dark:bg-white/10" />
                                      )}
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>

                <div className="flex items-center justify-center pb-1">
                    <div className="w-12 h-1 rounded-full bg-black/10 dark:bg-white/10" />
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
                className="absolute top-full mt-3 w-64 bg-white/80 dark:bg-[#121212]/90 backdrop-blur-xl border border-black/5 dark:border-white/5 rounded-[2rem] shadow-2xl overflow-hidden p-3 flex flex-col gap-2 z-50"
            >
                <div className="flex items-center gap-3 p-2 mb-1 border-b border-black/5 dark:border-white/5 pb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-inner">
                        AD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-black text-black/90 dark:text-white/90">{t("hud.system.userName")}</span>
                        <span className="text-[10px] font-medium text-black/40 dark:text-white/40 italic">
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
                        className="flex items-center justify-between p-3 rounded-2xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-[11px] font-bold"
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
        <Link href={href} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all group border border-transparent hover:border-black/5 dark:hover:border-white/10">
            <div className="text-black/40 dark:text-white/40 group-hover:text-black dark:group-hover:text-white transition-colors">
                {icon}
            </div>
            <span className="text-[9px] font-black text-black/40 dark:text-white/40 uppercase tracking-tighter group-hover:text-black/80 dark:group-hover:text-white/80">{label}</span>
        </Link>
    )
}
