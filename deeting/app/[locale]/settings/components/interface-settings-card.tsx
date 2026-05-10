"use client";

import { Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useAdvancedMode } from "@/hooks/use-advanced-mode";
import { Switch } from "@/components/ui/shadcn/switch";

export function InterfaceSettingsCard() {
  const t = useI18n("settings");
  const { isAdvancedMode, toggleAdvancedMode } = useAdvancedMode();

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:bg-purple-400/10 dark:text-purple-400">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("interface.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("interface.description")}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/30 bg-muted/20 px-4 py-3 dark:bg-muted/10">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {t("interface.advancedModeLabel")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("interface.advancedModeHelp")}
            </p>
          </div>
          <Switch
            checked={isAdvancedMode}
            onCheckedChange={toggleAdvancedMode}
            aria-label={t("interface.advancedModeLabel")}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("interface.scopeBadge")}
        </span>
      </div>
    </div>
  );
}
