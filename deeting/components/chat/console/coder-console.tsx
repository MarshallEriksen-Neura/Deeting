'use client';

import * as React from 'react';
import { X, Play, Terminal, Layers, Command } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const CoderConsole = React.memo(function CoderConsole() {
  const t = useI18n('chat');
  
  return (
    <div className="flex flex-col h-full p-0">
      {/* 1. Terminal Header (Status Bar) */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-xs font-mono font-bold tracking-tight">{t("coder.envLabel")}</span>
           </div>
           <span className="text-xs text-black/20 dark:text-white/20 font-mono">|</span>
           <span className="text-xs text-black/50 dark:text-white/40 font-mono">
             {t("coder.envMeta", { version: "v3.11.4", latency: "4ms" })}
           </span>
        </div>
        
        <Link href="/chat" scroll={false}>
            <Button variant="ghost" size="icon-sm">
                <X className="w-3.5 h-3.5" />
            </Button>
        </Link>
      </div>
      
      {/* 2. Editor Body */}
      <div className="flex-1 flex relative">
        {/* Line Numbers (Fake) */}
        <div className="w-8 py-3 text-right pr-2 text-black/20 dark:text-white/10 font-mono text-xs select-none border-r border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01]">
            1<br/>2<br/>3
        </div>
        
        <Textarea
            className="flex-1 bg-transparent outline-none text-gray-800 dark:text-gray-300 font-mono resize-none p-3 text-sm leading-relaxed placeholder-black/20 dark:placeholder-white/10 border-0 focus-visible:ring-0"
            placeholder={t("coder.placeholder")}
            autoFocus
            spellCheck={false}
        />
      </div>
      
      {/* 3. Action Footer */}
      <div className="px-4 py-2 border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex justify-between items-center">
        <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-black/50 dark:text-white/40 hover:text-black dark:hover:text-white">
                <Layers className="w-3 h-3" /> {t("coder.libraries")}
            </Button>
            <Button variant="ghost" size="sm" className="text-black/50 dark:text-white/40 hover:text-black dark:hover:text-white">
                <Command className="w-3 h-3" /> {t("coder.shortcuts")}
            </Button>
        </div>

        <Button className="bg-green-600 hover:bg-green-500 text-white font-mono font-bold uppercase tracking-wider shadow-lg shadow-green-900/20 border border-green-500/30" size="sm">
           {t("coder.run")} <Play className="w-3 h-3 fill-current" />
        </Button>
      </div>
    </div>
  );
});
