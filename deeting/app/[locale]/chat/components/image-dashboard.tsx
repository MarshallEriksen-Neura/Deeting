'use client';
import { X, Wand2, RefreshCcw, Palette, Image as ImageIcon, SlidersHorizontal, Ratio, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useI18n } from '@/hooks/use-i18n';

export default function ImageDashboard() {
  const t = useI18n('chat');
  return (
    <div className="flex h-full w-full">
      
      {/* ZONE 1: Style & Tools (Left Sidebar) */}
      <div className="w-16 border-r border-black/5 dark:border-white/5 flex flex-col items-center py-4 gap-4 bg-black/[0.02] dark:bg-white/[0.02]">
         <div className="w-8 h-8 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-2">
            <Wand2 className="w-4 h-4" />
         </div>
         
         <TooltipButton icon={<Palette className="w-4 h-4" />} label={t("image.toolbar.style")} active />
         <TooltipButton icon={<ImageIcon className="w-4 h-4" />} label={t("image.toolbar.refImage")} />
         <TooltipButton icon={<SlidersHorizontal className="w-4 h-4" />} label={t("image.toolbar.settings")} />
         
         <div className="mt-auto">
            <Link href="/chat" scroll={false}>
                <button className="text-black/20 dark:text-white/20 hover:text-black dark:hover:text-white transition-colors p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg">
                    <X className="w-4 h-4" />
                </button>
            </Link>
         </div>
      </div>

      {/* ZONE 2: Main Prompt Area (Center) */}
      <div className="flex-1 flex flex-col p-5 relative">
         <label className="text-xs font-bold text-purple-500/80 dark:text-purple-400/80 mb-2 uppercase tracking-widest">
           {t("image.prompt.label")}
         </label>
         <textarea 
            className="w-full h-full bg-transparent text-black/90 dark:text-white/90 resize-none outline-none font-medium text-lg placeholder-black/10 dark:placeholder-white/10 leading-relaxed"
            placeholder={t("image.prompt.placeholder")}
            autoFocus
         />
         
         {/* Inline Hints */}
         <div className="flex gap-2 mt-auto overflow-x-auto no-scrollbar pb-1">
            <Badge text={t("image.badges.cyberpunk")} />
            <Badge text={t("image.badges.cinematicLighting")} />
            <Badge text={t("image.badges.resolution")} />
            <Badge text={t("image.badges.addNegative")} opacity="opacity-40" dashed />
         </div>
      </div>

      {/* ZONE 3: Parameters & Action (Right Sidebar) */}
      <div className="w-48 border-l border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] p-4 flex flex-col gap-4">
         {/* Aspect Ratio Selector */}
         <div className="space-y-2">
            <span className="text-xs text-black/40 dark:text-white/40 font-medium uppercase tracking-wider">
              {t("image.aspectRatio")}
            </span>
            <div className="grid grid-cols-3 gap-2">
               <RatioBox label="1:1" active />
               <RatioBox label="16:9" />
               <RatioBox label="9:16" />
            </div>
         </div>

         {/* Model Version */}
         <div className="space-y-2">
            <span className="text-xs text-black/40 dark:text-white/40 font-medium uppercase tracking-wider">
              {t("image.model")}
            </span>
            <div className="px-3 py-2 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5 text-xs text-black/70 dark:text-white/70 flex justify-between items-center cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
               <span>{t("image.modelVersion")}</span>
               <RefreshCcw className="w-3 h-3 text-black/20 dark:text-white/20" />
            </div>
         </div>

         {/* Generate Button (The Orb) */}
         <button className="mt-auto w-full h-12 relative group rounded-xl overflow-hidden shadow-lg shadow-purple-500/20">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 transition-transform duration-300 group-hover:scale-110" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/20 transition-opacity" />
            <span className="relative z-10 text-white font-bold text-sm tracking-wide flex items-center justify-center gap-2">
               {t("image.generate")} <Sparkles className="w-3 h-3 fill-white/50" />
            </span>
         </button>
      </div>

    </div>
  )
}

function TooltipButton({ icon, label, active }: any) {
    return (
        <button className={`p-2.5 rounded-xl transition-all ${active ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white shadow-inner' : 'text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}`}>
            {icon}
        </button>
    )
}

function Badge({ text, opacity = "opacity-100", dashed }: any) {
    return (
        <span className={`text-[10px] px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 border ${dashed ? 'border-dashed border-black/20 dark:border-white/20' : 'border-black/5 dark:border-white/5'} text-black/60 dark:text-white/60 whitespace-nowrap cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-colors ${opacity}`}>
            {text}
        </span>
    )
}

function RatioBox({ label, active }: any) {
    return (
        <button className={`h-8 rounded-lg border text-[10px] font-medium transition-all ${active ? 'bg-purple-500/10 dark:bg-purple-500/20 border-purple-500/50 text-purple-600 dark:text-purple-300' : 'border-black/5 dark:border-white/5 text-black/40 dark:text-white/20 hover:border-black/20 dark:hover:border-white/20 hover:text-black/80 dark:hover:text-white/60'}`}>
            {label}
        </button>
    )
}
