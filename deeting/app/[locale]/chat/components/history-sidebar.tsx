'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Search, MessageSquare, Clock, Plus, Trash2, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HistorySidebar({ isOpen, onClose }: HistorySidebarProps) {
  // Mock Data
  const historyGroups = [
    {
      label: "Today",
      items: [
        "Project Deeting OS Design",
        "React Server Components Fix",
        "Cyberpunk City Concept Gen",
      ]
    },
    {
      label: "Yesterday",
      items: [
        "Next.js 14 Routing Guide",
        "Python Script Optimization",
      ]
    },
    {
      label: "Previous 7 Days",
      items: [
        "Marketing Copy for Launch",
        "Logo Iterations v3",
        "Database Schema Review"
      ]
    }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (Click to close) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
          />

          {/* Sidebar Panel */}
          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-4 bottom-4 left-4 w-80 z-[70] flex flex-col"
          >
            {/* Glass Container */}
            <div className="h-full w-full bg-white/80 dark:bg-[#121212]/90 backdrop-blur-2xl border border-black/5 dark:border-white/5 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              
              {/* Header */}
              <div className="p-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-bold text-black/80 dark:text-white/80 tracking-wide">HISTORY</h2>
                <button className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white">
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Search */}
              <div className="px-4 py-2">
                <div className="relative group">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-black/30 dark:text-white/30 group-hover:text-black/50 dark:group-hover:text-white/50 transition-colors" />
                  <input 
                    type="text" 
                    placeholder="Search conversations..." 
                    className="w-full bg-black/5 dark:bg-white/5 border border-transparent focus:border-black/10 dark:focus:border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-black/30 dark:placeholder:text-white/30 text-black/80 dark:text-white/80"
                  />
                </div>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-6 no-scrollbar">
                {historyGroups.map((group, groupIndex) => (
                  <div key={groupIndex} className="px-2">
                    <h3 className="text-[10px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wider mb-2 px-2">{group.label}</h3>
                    <div className="space-y-1">
                      {group.items.map((item, i) => (
                        <div key={i} className="group flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-all">
                          <MessageSquare className="w-4 h-4 text-black/40 dark:text-white/40 shrink-0" />
                          <span className="text-sm text-black/70 dark:text-white/70 truncate flex-1 font-medium group-hover:text-black dark:group-hover:text-white">{item}</span>
                          
                          {/* Hover Actions */}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center">
                             <button className="p-1 hover:text-red-500 transition-colors text-black/30 dark:text-white/30">
                                <Trash2 className="w-3.5 h-3.5" />
                             </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
                <button className="w-full flex items-center justify-center gap-2 text-xs font-medium text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors">
                   <Clock className="w-3 h-3" /> View Archived
                </button>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
