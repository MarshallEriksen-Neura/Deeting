"use client";

import { Compass, Link2 } from "lucide-react";
import { Control } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { useI18n } from "@/hooks/use-i18n";
import type { SettingsFormValues } from "../types";

interface DesktopScoutSettingsCardProps {
  control: Control<SettingsFormValues>;
  isTauriRuntime: boolean;
  canEditDesktop: boolean;
}

export function DesktopScoutSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
}: DesktopScoutSettingsCardProps) {
  const t = useI18n("settings");

  if (!isTauriRuntime) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:bg-teal-400/10 dark:text-teal-400">
            <Compass className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("desktop.scout.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("desktop.scout.description")}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        <FormField
          control={control}
          name="scoutBaseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium">
                {t("desktop.scout.baseUrlLabel")}
              </FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder="https://your-scout.example.com"
                    className="rounded-xl pl-9"
                    disabled={!canEditDesktop}
                  />
                </div>
              </FormControl>
              <FormDescription>
                {t("desktop.scout.baseUrlHelp")}
              </FormDescription>
            </FormItem>
          )}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("desktop.scout.footerHint")}
        </span>
      </div>
    </div>
  );
}
