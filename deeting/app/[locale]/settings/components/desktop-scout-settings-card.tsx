"use client";

import { Compass, Link2 } from "lucide-react";
import { Control } from "react-hook-form";

import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
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
    <GlassCard
      blur="default"
      theme="surface"
      hover="lift"
      padding="lg"
      className="border-0"
    >
      <GlassCardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GlassCardTitle className="text-lg text-foreground">
              {t("desktop.scout.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("desktop.scout.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Compass className="h-3 w-3" />
            {t("desktop.scopeBadge")}
          </Badge>
        </div>
      </GlassCardHeader>
      <GlassCardContent>
        <FormField
          control={control}
          name="scoutBaseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("desktop.scout.baseUrlLabel")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
                    <Link2 className="mr-1 h-3 w-3" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder="https://your-scout.example.com"
                    className="pl-8"
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
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("desktop.scout.footerHint")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  );
}
