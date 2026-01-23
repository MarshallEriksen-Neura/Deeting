"use client";

import * as React from "react";
import {
  Sparkles,
  ImageIcon,
  X,
  Clock,
  Plus,
  Grid,
  Monitor,
  Smartphone,
  Sliders,
  MessageSquarePlus,
  MessageSquare,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { GlassButton } from "@/components/ui/glass-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface FloatingConsoleProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  disabled?: boolean;
  recentImages?: Array<{ url: string; taskId: string }>;
  onImageSelect?: (taskId: string) => void;
  onNewSession?: () => void;
  ratio: "1:1" | "16:9" | "9:16";
  onRatioChange?: (ratio: "1:1" | "16:9" | "9:16") => void;
  guidance: number;
  onGuidanceChange?: (value: number) => void;
  steps: number;
  onStepsChange?: (value: number) => void;
  selectedNegatives?: Set<string>;
  onSelectedNegativesChange?: (negatives: Set<string>) => void;
}

// iOS 风格负面提示词预设
const NEGATIVE_TAGS = [
  "blur",
  "distortion",
  "noise",
  "low quality",
  "watermark",
  "signature",
  "ugly",
  "deformed",
] as const;

const RATIO_CONFIG = {
  "1:1": { icon: Grid, label: "正方形" },
  "16:9": { icon: Monitor, label: "横版" },
  "9:16": { icon: Smartphone, label: "竖版" },
} as const;

export const FloatingConsole = React.memo<FloatingConsoleProps>(function FloatingConsole({
  prompt,
  onPromptChange,
  onGenerate,
  isGenerating,
  disabled,
  recentImages = [],
  onImageSelect,
  onNewSession,
  ratio,
  onRatioChange,
  guidance,
  onGuidanceChange,
  steps,
  onStepsChange,
  selectedNegatives = new Set(),
  onSelectedNegativesChange,
}) {
  const t = useI18n("chat");
  const pathname = usePathname();
  const [showNegativeTags, setShowNegativeTags] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [showModeMenu, setShowModeMenu] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // 自动调整文本框高度
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [prompt]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && !isGenerating && prompt.trim()) {
          onGenerate();
        }
      }
    },
    [prompt, disabled, isGenerating, onGenerate]
  );

  const toggleNegativeTag = React.useCallback((tag: string) => {
    const newSet = new Set(selectedNegatives);
    if (newSet.has(tag)) {
      newSet.delete(tag);
    } else {
      newSet.add(tag);
    }
    onSelectedNegativesChange?.(newSet);
  }, [selectedNegatives, onSelectedNegativesChange]);

  const handleClearPrompt = React.useCallback(() => {
    onPromptChange("");
  }, [onPromptChange]);

  const handleToggleModeMenu = React.useCallback(() => {
    setShowModeMenu((prev) => !prev);
  }, []);

  const handleToggleNegativeTags = React.useCallback(() => {
    setShowNegativeTags((prev) => !prev);
  }, []);

  const hasPrompt = prompt.trim().length > 0;
  const hasRecent = recentImages.length > 0;
  const negativeCount = selectedNegatives.size;
  const ratioLabel = RATIO_CONFIG[ratio]?.label ?? ratio;
  const isImage = pathname?.includes("/create/image");
  const isCoder = pathname?.includes("/coder");
  const isChat = !isImage && !isCoder;

  const resolveModeItemClass = React.useCallback((active: boolean) =>
    cn(
      "flex items-center gap-3 p-3 min-h-[44px] rounded-xl cursor-pointer group transition-colors",
      active
        ? "bg-slate-100/90 dark:bg-white/15 text-slate-900 dark:text-white"
        : "hover:bg-slate-100/80 dark:hover:bg-white/10 text-slate-700 dark:text-white/80"
    ), []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full max-w-4xl lg:max-w-5xl mx-auto px-3 sm:px-4"
    >
      {/* 负面提示词面板 */}
      <AnimatePresence>
        {showNegativeTags && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute bottom-full mb-3 left-0 right-0 flex justify-center z-50"
          >
            <GlassCard
              blur="xl"
              theme="surface"
              className="w-full max-w-2xl overflow-hidden rounded-[24px]"
              innerBorder={true}
            >
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t("image.console.negative")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("image.console.negativeSelected", { count: selectedNegatives.size })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {NEGATIVE_TAGS.map((tag) => {
                    const isSelected = selectedNegatives.has(tag);
                    return (
                      <motion.div
                        key={tag}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleNegativeTag(tag)}
                          className={cn(
                            "h-8 rounded-full px-3 text-xs font-medium transition-all",
                            isSelected
                              ? "bg-primary/20 text-primary ring-1 ring-primary/30 hover:bg-primary/25"
                              : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                          )}
                        >
                          {tag}
                        </Button>
                      </motion.div>
                    );
                  })}
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-xs font-medium bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    >
                      <Plus className="w-3 h-3" />
                      {t("image.console.negativeCustom")}
                    </Button>
                  </motion.div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主控制台 */}
      <GlassCard
        blur="xl"
        theme="surface"
        className={cn(
          "relative overflow-visible transition-all duration-300 rounded-[28px] shadow-[0_18px_50px_-30px_rgba(15,23,42,0.3)]",
          showNegativeTags && "ring-1 ring-primary/20"
        )}
        innerBorder={true}
        hover="none"
      >
        {/* 顶部光泽效果 */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          {/* 左侧历史预览 */}
          <div className="flex items-center gap-3 md:w-52">
            <GlassButton
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label={t("image.console.historyButton")}
              className="size-11 rounded-2xl bg-white/20 text-muted-foreground hover:bg-white/30 hover:text-foreground"
            >
              <ImageIcon className="w-5 h-5" />
            </GlassButton>

            <div className="hidden sm:flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                <Clock className="w-3 h-3" />
                <span>{t("image.console.recent")}</span>
              </div>
              {hasRecent ? (
                <ScrollArea className="w-full h-10">
                  <div className="flex gap-2 pr-3">
                    {recentImages.slice(0, 8).map((item) => (
                      <motion.div
                        key={item.taskId}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.96 }}
                      >
                        <GlassButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onImageSelect?.(item.taskId)}
                          className="relative size-10 rounded-2xl overflow-hidden ring-1 ring-white/40 hover:ring-primary/40"
                          aria-label={t("image.console.selectHistory")}
                        >
                          <img
                            src={item.url}
                            alt={t("image.console.historyAlt")}
                            className="size-full object-cover"
                          />
                        </GlassButton>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <span className="text-xs text-muted-foreground/60">
                  {t("image.console.recentEmpty")}
                </span>
              )}
            </div>
          </div>

          {/* 输入区域 */}
          <div className="relative flex-1">
            <div className="relative flex items-center rounded-[24px] bg-white/70 dark:bg-white/10 border border-white/30 dark:border-white/10 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.25)] backdrop-blur-xl focus-within:ring-1 focus-within:ring-primary/25">
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("image.prompt.placeholder")}
                aria-label={t("image.prompt.label")}
                className="min-h-[52px] max-h-40 resize-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground shadow-none focus-visible:ring-0 focus-visible:border-transparent placeholder:text-muted-foreground/50 pr-16"
                rows={1}
              />

              {hasPrompt && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute right-14 top-1/2 -translate-y-1/2"
                >
                  <GlassButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("image.console.clearPrompt")}
                    onClick={handleClearPrompt}
                    className="size-8 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </GlassButton>
                </motion.div>
              )}

              <motion.div
                className="absolute right-2 top-1/2 -translate-y-1/2"
                whileHover={!disabled && !isGenerating ? { scale: 1.05 } : {}}
                whileTap={!disabled && !isGenerating ? { scale: 0.96 } : {}}
              >
                <GlassButton
                  type="button"
                  onClick={onGenerate}
                  disabled={disabled || isGenerating || !hasPrompt}
                  variant="default"
                  size="icon-lg"
                  aria-label={t("image.generate")}
                  className={cn(
                    "size-12 rounded-2xl",
                    "bg-gradient-to-b from-[#2563EB] via-[#3B82F6] to-[#1D4ED8]",
                    "shadow-[0_10px_28px_-12px_rgba(37,99,235,0.55),inset_0_1px_0_rgba(255,255,255,0.45)]",
                    "hover:shadow-[0_16px_36px_-12px_rgba(37,99,235,0.65)]",
                    isGenerating && "cursor-wait"
                  )}
                >
                  {isGenerating ? (
                    <svg
                      className="w-5 h-5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <Sparkles className="w-5 h-5 fill-current" />
                  )}
                </GlassButton>
              </motion.div>
            </div>
          </div>

          {/* 右侧快捷操作 */}
          <div className="flex items-center gap-2 justify-end">
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <GlassButton
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={t("controls.menu")}
                    onClick={handleToggleModeMenu}
                    className={cn(
                      "size-10 rounded-2xl bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-transform hover:scale-[1.02] active:scale-95",
                      showModeMenu && "ring-1 ring-primary/25 text-primary rotate-45"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </GlassButton>
                </TooltipTrigger>
                <TooltipContent side="top">{t("controls.menu")}</TooltipContent>
              </Tooltip>

              <AnimatePresence>
                {showModeMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: -10, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                    className="absolute bottom-full right-0 mb-2 bg-white/95 dark:bg-[#1a1a1a] border border-slate-200/70 dark:border-white/10 rounded-2xl p-2 shadow-xl backdrop-blur-xl flex flex-col gap-1 w-44 z-50 origin-bottom-right"
                  >
                    <Link href="/chat" scroll={false} onClick={() => setShowModeMenu(false)}>
                      <div className={resolveModeItemClass(isChat)}>
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-all">
                          <MessageSquare className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-medium">
                          {t("controls.chat")}
                        </span>
                      </div>
                    </Link>
                    <Link href="/chat/create/image" scroll={false} onClick={() => setShowModeMenu(false)}>
                      <div className={resolveModeItemClass(isImage)}>
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-all">
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-medium">
                          {t("controls.image")}
                        </span>
                      </div>
                    </Link>
                    <Link href="/chat/coder" scroll={false} onClick={() => setShowModeMenu(false)}>
                      <div className={resolveModeItemClass(isCoder)}>
                        <div className="w-9 h-9 rounded-lg bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 group-hover:scale-110 transition-all">
                          <span className="font-mono text-sm font-bold">{`</>`}</span>
                        </div>
                        <span className="text-sm font-medium">
                          {t("controls.code")}
                        </span>
                      </div>
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => {
                    setShowModeMenu(false);
                    onNewSession?.();
                  }}
                  aria-label={t("header.newChat")}
                  className="size-10 rounded-2xl bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-transform hover:scale-[1.02] active:scale-95"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </GlassButton>
              </TooltipTrigger>
              <TooltipContent side="top">{t("header.newChat")}</TooltipContent>
            </Tooltip>

            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t("image.console.settings")}
                  className={cn(
                    "size-10 rounded-2xl bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-transform hover:scale-[1.02] active:scale-95",
                    settingsOpen && "ring-1 ring-primary/25 text-primary"
                  )}
                >
                  <Sliders className="w-4 h-4" />
                </GlassButton>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-[420px] max-w-[92vw] rounded-2xl border border-white/30 dark:border-white/10 bg-white/95 dark:bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-2xl p-4"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t("image.console.settings")}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t("image.console.summary")}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/60 dark:bg-white/10 px-2.5 py-1 text-xs text-foreground/80 ring-1 ring-white/30">
                        {t("image.aspectRatio")} {ratioLabel}
                      </span>
                      <span className="rounded-full bg-white/60 dark:bg-white/10 px-2.5 py-1 text-xs text-foreground/80 ring-1 ring-white/30">
                        {t("image.settings.steps")} {steps}
                      </span>
                      <span className="rounded-full bg-white/60 dark:bg-white/10 px-2.5 py-1 text-xs text-foreground/80 ring-1 ring-white/30">
                        {t("image.settings.guidance")} {guidance.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/30 dark:border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {t("image.aspectRatio")}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {(Object.keys(RATIO_CONFIG) as Array<keyof typeof RATIO_CONFIG>).map((r) => {
                          const Icon = RATIO_CONFIG[r].icon;
                          const isActive = ratio === r;
                          return (
                            <GlassButton
                              key={r}
                              type="button"
                              onClick={() => onRatioChange?.(r)}
                              className={cn(
                                "h-12 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all",
                                isActive
                                  ? "bg-primary/12 text-primary ring-1 ring-primary/25 shadow-sm"
                                  : "bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground"
                              )}
                              variant="ghost"
                              size="sm"
                            >
                              <Icon className="w-4 h-4" />
                              <span className="text-[10px]">{RATIO_CONFIG[r].label}</span>
                            </GlassButton>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/30 dark:border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            {t("image.settings.guidance")}
                          </span>
                          <span className="rounded-full bg-white/60 dark:bg-white/10 px-2 py-0.5 text-xs font-mono text-foreground/80 ring-1 ring-white/30">
                            {guidance.toFixed(1)}
                          </span>
                        </div>
                        <Slider
                          value={[guidance]}
                          onValueChange={([value]) => onGuidanceChange?.(value)}
                          min={1}
                          max={20}
                          step={0.5}
                          className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_[data-slot=slider-track]]:bg-white/30"
                        />
                      </div>

                      <div className="rounded-2xl border border-white/30 dark:border-white/10 bg-white/70 dark:bg-white/5 p-3 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            {t("image.settings.steps")}
                          </span>
                          <span className="rounded-full bg-white/60 dark:bg-white/10 px-2 py-0.5 text-xs font-mono text-foreground/80 ring-1 ring-white/30">
                            {steps}
                          </span>
                        </div>
                        <Slider
                          value={[steps]}
                          onValueChange={([value]) => onStepsChange?.(value)}
                          min={10}
                          max={50}
                          step={1}
                          className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_[data-slot=slider-track]]:bg-white/30"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <GlassButton
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={handleToggleNegativeTags}
                aria-label={t("image.console.negativeToggle")}
                className={cn(
                  "size-10 rounded-2xl",
                  showNegativeTags || negativeCount > 0
                    ? "bg-primary/15 text-primary"
                    : "bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground"
                )}
              >
                <span className="text-xs font-semibold">T</span>
              </GlassButton>
            </motion.div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
});
