'use client';
import { ChevronDown, LayoutGrid, Home, LayoutDashboard, ShoppingBag, LogOut, User, Settings, Sun, Moon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { HistorySidebar } from '../components/history-sidebar';

export default function HUD() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { setTheme, theme } = useTheme();

  return (
    <>
    <nav className="flex flex-col items-center gap-2 px-1 py-1 animate-in fade-in slide-in-from-top-4 duration-700 pointer-events-auto relative z-50">
      
      {/* 1. Minimal Status Capsule */}
      <div className="flex items-center gap-3 px-4 py-2 rounded-full border border-black/5 dark:border-white/5 bg-white/70 dark:bg-black/20 backdrop-blur-md shadow-sm dark:shadow-none transition-colors duration-500 relative z-50">
          
          {/* Agent Indicator (Left) */}
          <Link href="/chat/select-agent" scroll={false}>
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
              <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <span className="text-xs font-medium text-black/80 dark:text-white/80 tracking-wide uppercase">GPT-4o</span>
            </div>
          </Link>

          <span className="text-black/10 dark:text-white/10 text-xs">|</span>

          {/* Session Title (Center) - CLICK TO OPEN HISTORY */}
          <div 
             onClick={() => setIsHistoryOpen(true)}
             className="flex items-center gap-1 text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition-colors cursor-pointer group"
          >
             <span className="text-xs font-medium truncate max-w-[150px]">Project Deeting OS</span>
             <ChevronDown className="w-3 h-3 text-black/30 dark:text-white/30 group-hover:text-black/60 dark:group-hover:text-white/60 transition-transform group-hover:rotate-180" />
          </div>

          <span className="text-black/10 dark:text-white/10 text-xs">|</span>

          {/* System Menu Trigger (Right) */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`
                p-1 rounded-full transition-all duration-300
                ${isMenuOpen ? 'bg-black/5 dark:bg-white/10 text-black dark:text-white' : 'text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}
            `}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>

      </div>

      {/* 2. System Control Center Dropdown */}
      <AnimatePresence>
        {isMenuOpen && (
            <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="absolute top-full mt-2 w-64 bg-white/80 dark:bg-[#121212]/90 backdrop-blur-xl border border-black/5 dark:border-white/5 rounded-2xl shadow-2xl overflow-hidden p-2 flex flex-col gap-1"
            >
                {/* User Profile Snippet */}
                <div className="flex items-center gap-3 p-2 mb-1 border-b border-black/5 dark:border-white/5 pb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-inner">
                        AD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-black/90 dark:text-white/90">Admin User</span>
                        <span className="text-[10px] text-black/50 dark:text-white/50">admin@higress.ai</span>
                    </div>
                </div>

                {/* Navigation Grid */}
                <div className="grid grid-cols-2 gap-1 mb-1">
                    <MenuLink href="/" icon={<Home className="w-4 h-4" />} label="Home" />
                    <MenuLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" />
                    <MenuLink href="/market" icon={<ShoppingBag className="w-4 h-4" />} label="Market" />
                    <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />} label="Settings" />
                </div>

                {/* Theme & Logout */}
                <div className="flex flex-col gap-1 border-t border-black/5 dark:border-white/5 pt-1">
                     <button 
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-xs font-medium text-black/70 dark:text-white/70 w-full text-left"
                     >
                        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        <span>Toggle Theme</span>
                     </button>
                     
                     <Link href="/login" className="flex items-center gap-3 p-2 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors text-xs font-medium text-black/70 dark:text-white/70 w-full text-left">
                        <LogOut className="w-4 h-4" />
                        <span>Log Out</span>
                     </Link>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

    </nav>
    
    {/* Global History Sidebar managed by HUD state */}
    <HistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}

function MenuLink({ href, icon, label }: any) {
    return (
        <Link href={href} className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors group">
            <div className="text-black/60 dark:text-white/60 group-hover:text-black dark:group-hover:text-white transition-colors">
                {icon}
            </div>
            <span className="text-[10px] font-medium text-black/50 dark:text-white/50 group-hover:text-black/80 dark:group-hover:text-white/80">{label}</span>
        </Link>
    )
}