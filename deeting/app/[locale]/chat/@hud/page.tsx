'use client';
import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, Settings, Sun, Moon, Cpu, Thermometer, Zap, Check, Sliders, Sparkles, User, ArrowRight, Bot, Search, Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { HistorySidebar } from '../components/history-sidebar';
import { useChatStore } from '@/store/chat-store';
import { useShallow } from 'zustand/react/shallow';

const AVAILABLE_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', icon: Zap, color: 'text-emerald-500' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', icon: Cpu, color: 'text-orange-500' },
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', icon: Cpu, color: 'text-blue-500' },
];

const RECENT_AGENTS = [
  { id: '1', name: 'Marketing Pro', avatar: '📈', color: 'bg-blue-500/10 text-blue-500' },
  { id: '2', name: 'Code Master', avatar: '💻', color: 'bg-purple-500/10 text-purple-500' },
  { id: '3', name: 'Creative Writer', avatar: '✍️', color: 'bg-orange-500/10 text-orange-500' },
  { id: '4', name: 'Data Analyst', avatar: '📊', color: 'bg-green-500/10 text-green-500' },
  { id: '5', name: 'Translator', avatar: '🌍', color: 'bg-indigo-500/10 text-indigo-500' },
  { id: '6', name: 'HR Assistant', avatar: '🤝', color: 'bg-pink-500/10 text-pink-500' },
];

export default function HUD() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  
  const { setTheme, theme } = useTheme();
  
  const { config, setConfig } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
    }))
  );

  const activeModel = AVAILABLE_MODELS.find(m => m.id === config.model) || AVAILABLE_MODELS[0];

  return (
    <>
    <nav className="flex flex-col items-center gap-2 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700 pointer-events-auto relative z-50">
      
      {/* 1. Minimal Status Capsule (The "Dynamic Island") */}
      <motion.div 
        layout
        className="flex items-center gap-3 px-4 py-2 rounded-full border border-black/5 dark:border-white/5 bg-white/70 dark:bg-black/20 backdrop-blur-md shadow-sm dark:shadow-none transition-all duration-500 relative z-50 group"
      >
          
          {/* Agent/Model Pulse Indicator + Quick Toggle */}
          <div 
            onClick={() => setIsControlCenterOpen(!isControlCenterOpen)}
            className="flex items-center gap-2 cursor-pointer transition-all hover:scale-105"
          >
            <div className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeModel.color.replace('text-', 'bg-')}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeModel.color.replace('text-', 'bg-')}`}></span>
            </div>
            <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] font-bold text-black/40 dark:text-white/40 uppercase tracking-tighter">Active Agent</span>
                <span className="text-xs font-bold text-black dark:text-white flex items-center gap-1">
                    {activeModel.name}
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
             <span className="text-xs font-semibold truncate max-w-[120px]">Deeting OS</span>
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

      {/* 2. Control Center (Agent Switcher + Model Config) */}
      <AnimatePresence>
        {isControlCenterOpen && (
            <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute top-full mt-3 w-80 bg-white/80 dark:bg-[#0a0a0a]/90 backdrop-blur-3xl border border-black/5 dark:border-white/10 rounded-[2.5rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] overflow-hidden p-4 flex flex-col gap-5 z-50"
            >
                {/* Agent Quick Switch Section */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-black text-black/30 dark:text-white/30 uppercase tracking-[0.2em]">Select Agent</span>
                        <div className="flex gap-2">
                             <Link href="/chat/select-agent" scroll={false} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors">
                                <Search className="w-3 h-3" />
                             </Link>
                             <Link href="/market" scroll={false} className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center gap-1">
                                Market <ArrowRight className="w-2.5 h-2.5" />
                            </Link>
                        </div>
                    </div>
                    
                    {/* Horizontal Scrollable Agent List */}
                    <div className="relative -mx-4 px-4">
                        <div className="flex gap-3 overflow-x-auto pb-4 pt-1 px-4 snap-x no-scrollbar mask-linear-fade">
                            {/* Create New Trigger */}
                             <Link href="/chat/select-agent" className="flex flex-col items-center gap-2 group/agent cursor-pointer min-w-[3.5rem] snap-start">
                                <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-black/10 dark:border-white/10 flex items-center justify-center text-black/20 dark:text-white/20 group-hover/agent:border-black/30 dark:group-hover/agent:border-white/30 group-hover/agent:text-black/50 dark:group-hover/agent:text-white/50 transition-all duration-300">
                                    <Plus className="w-5 h-5" />
                                </div>
                                <span className="text-[10px] font-bold text-black/40 dark:text-white/40 truncate w-full text-center group-hover/agent:text-black/60 dark:group-hover/agent:text-white/60">New</span>
                            </Link>

                            {RECENT_AGENTS.map((agent) => (
                                <div key={agent.id} className="flex flex-col items-center gap-2 group/agent cursor-pointer min-w-[3.5rem] snap-start">
                                    <div className={`w-14 h-14 rounded-2xl ${agent.color} flex items-center justify-center text-2xl shadow-sm group-hover/agent:scale-105 transition-all duration-300 ring-2 ring-transparent group-hover/agent:ring-black/5 dark:group-hover/agent:ring-white/10`}>
                                        {agent.avatar}
                                    </div>
                                    <span className="text-[10px] font-bold text-black/60 dark:text-white/60 truncate w-full text-center">{agent.name}</span>
                                </div>
                            ))}
                        </div>
                        {/* Fade Gradients for Scroll Hint */}
                        <div className="absolute top-0 bottom-4 left-0 w-4 bg-gradient-to-r from-white/80 dark:from-[#0a0a0a]/90 to-transparent pointer-events-none" />
                        <div className="absolute top-0 bottom-4 right-0 w-4 bg-gradient-to-l from-white/80 dark:from-[#0a0a0a]/90 to-transparent pointer-events-none" />
                    </div>
                </div>

                {/* Model & Runtime Section */}
                <div className="flex flex-col gap-4 bg-black/5 dark:bg-white/5 rounded-[2rem] p-4 border border-black/5 dark:border-white/5">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-black/30 dark:text-white/30 uppercase tracking-[0.2em]">Engine</span>
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-bold">
                            OPTIMIZED
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {AVAILABLE_MODELS.map((model) => (
                            <button
                                key={model.id}
                                onClick={() => setConfig({ model: model.id })}
                                className={`
                                    flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-[10px] font-bold transition-all
                                    ${config.model === model.id ? 'bg-white dark:bg-black text-black dark:text-white shadow-md' : 'text-black/40 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5'}
                                `}
                            >
                                <model.icon className={`w-3 h-3 ${config.model === model.id ? model.color : 'text-current'}`} />
                                {model.name.split(' ')[0]}
                            </button>
                        ))}
                    </div>

                    {/* Sliders */}
                    <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[10px] font-bold text-black/50 dark:text-white/50 flex items-center gap-1.5">
                                    <Thermometer className="w-3 h-3" /> Temperature
                                </label>
                                <span className="text-[10px] font-mono font-bold">{config.temperature}</span>
                            </div>
                            <input 
                                type="range" min="0" max="2" step="0.1" value={config.temperature}
                                onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) })}
                                className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-black dark:accent-white"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[10px] font-bold text-black/50 dark:text-white/50 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" /> Top P
                                </label>
                                <span className="text-[10px] font-mono font-bold">{config.topP}</span>
                            </div>
                            <input 
                                type="range" min="0" max="1" step="0.05" value={config.topP}
                                onChange={(e) => setConfig({ topP: parseFloat(e.target.value) })}
                                className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-black dark:accent-white"
                            />
                        </div>
                    </div>
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
                        <span className="text-xs font-black text-black/90 dark:text-white/90">Admin User</span>
                        <span className="text-[10px] font-medium text-black/40 dark:text-white/40 italic">System Integrity: 100%</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <MenuLink href="/" icon={<Home className="w-4 h-4" />} label="Home" />
                    <MenuLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="OS Dashboard" />
                    <MenuLink href="/market" icon={<ShoppingBag className="w-4 h-4" />} label="Registry" />
                    <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />} label="Preferences" />
                </div>

                <div className="flex flex-col gap-1 mt-1">
                     <button 
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="flex items-center justify-between p-3 rounded-2xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-[11px] font-bold"
                     >
                        <div className="flex items-center gap-3">
                            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            <span>Interface Mode</span>
                        </div>
                        <span className="text-[9px] opacity-40 uppercase">{theme}</span>
                     </button>
                     
                     <Link href="/login" className="flex items-center gap-3 p-3 rounded-2xl hover:bg-red-500/10 hover:text-red-500 transition-colors text-[11px] font-bold">
                        <LogOut className="w-4 h-4" />
                        <span>Terminate Session</span>
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