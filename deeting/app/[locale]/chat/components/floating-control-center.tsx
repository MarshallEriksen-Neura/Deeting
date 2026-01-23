"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Sparkles, Layers, Zap, Grid, Monitor, Smartphone } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassButton } from "@/components/ui/glass-button";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface FloatingControlCenterProps {
  selectedModelId?: string;
  onModelChange?: (modelId: string) => void;
  ratio: "1:1" | "16:9" | "9:16";
  onRatioChange?: (ratio: "1:1" | "16:9" | "9:16") => void;
  guidance: number;
  onGuidanceChange?: (value: number) => void;
  steps: number;
  onStepsChange?: (value: number) => void;
  models?: Array<{ id: string; name: string; provider?: string }>;
}

const RATIO_CONFIG = {
  "1:1": { icon: Grid, label: "正方形" },
  "16:9": { icon: Monitor, label: "横版" },
  "9:16": { icon: Smartphone, label: "竖版" },
} as const;

export function FloatingControlCenter({
  selectedModelId,
  onModelChange,
  ratio,
  onRatioChange,
  guidance,
  onGuidanceChange,
  steps,
  onStepsChange,
  models = [],
}: FloatingControlCenterProps) {
  const t = useI18n("chat");
  const [expanded, setExpanded] = useState(false);
  const activeModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  );
  const modelLabel = activeModel?.name ?? t("model.placeholder");

  return (
    <div className="absolute top-6 right-6 z-50">
      <GlassCard
        blur="xl"
        theme="surface"
        className={cn(
          "transition-all duration-300 ease-out overflow-hidden rounded-2xl shadow-[0_8px_30px_-12px_rgba(37,99,235,0.18)]",
          expanded ? "w-64" : "w-auto"
        )}
        innerBorder={true}
        hover="none"
      >
        {/* 头部 - 始终显示 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("image.model")}
              </span>
              <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
                {modelLabel}
              </span>
            </div>
          </div>
          <GlassButton
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? t("image.console.collapse") : t("image.console.expand")}
            className="rounded-full text-muted-foreground hover:text-foreground bg-white/10 hover:bg-white/20"
          >
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                expanded && "rotate-180"
              )}
            />
          </GlassButton>
        </div>

        {/* 展开内容 */}
        <div
          className={cn(
            "transition-all duration-300 ease-out",
            expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="p-4 space-y-5">
            {/* 画面比例 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
                  {t("image.aspectRatio")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(RATIO_CONFIG) as Array<keyof typeof RATIO_CONFIG>).map(
                  (r) => {
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
                            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                            : "bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground"
                        )}
                        variant="ghost"
                        size="sm"
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[10px]">{RATIO_CONFIG[r].label}</span>
                      </GlassButton>
                    );
                  }
                )}
              </div>
            </div>

            {/* 引导强度 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  {t("image.settings.guidance")}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {guidance.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[guidance]}
                onValueChange={([v]) => onGuidanceChange?.(v)}
                min={1}
                max={20}
                step={0.5}
                className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_[data-slot=slider-track]]:bg-white/20"
              />
            </div>

            {/* 生成步数 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Layers className="w-3 h-3" />
                  {t("image.settings.steps")}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {steps}
                </span>
              </div>
              <Slider
                value={[steps]}
                onValueChange={([v]) => onStepsChange?.(v)}
                min={10}
                max={50}
                step={1}
                className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_[data-slot=slider-track]]:bg-white/20"
              />
            </div>

            {/* 模型选择 */}
            {models.length > 0 && (
              <div className="space-y-2">
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
                  {t("image.model")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {models.map((m) => (
                    <Button
                      key={m.id}
                      onClick={() => onModelChange?.(m.id)}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "rounded-full px-3 text-xs transition-all",
                        selectedModelId === m.id
                          ? "bg-primary/15 text-primary ring-1 ring-primary/20"
                          : "bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground"
                      )}
                    >
                      {m.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
