"use client";

import { Settings2, Shield, Trash2, Workflow } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";
import { Avatar, AvatarFallback } from "@/components/ui/shadcn/avatar";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/shadcn/card";
import { cn } from "@/lib/utils";
import type { LocalSkillRuntimeStatus, PluginMarketSkillItem } from "@/lib/api/plugin-market";

const COLOR_OPTIONS = [
  "from-blue-500 to-cyan-500",
  "from-pink-500 to-rose-500",
  "from-emerald-500 to-teal-500",
  "from-violet-500 to-purple-500",
  "from-orange-400 to-amber-500",
  "from-fuchsia-500 to-pink-500",
  "from-indigo-500 to-blue-500",
  "from-teal-500 to-green-500",
];

function pickColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 10000;
  }
  return COLOR_OPTIONS[hash % COLOR_OPTIONS.length];
}

interface PluginCardProps {
  plugin: PluginMarketSkillItem;
  runtimeStatus?: LocalSkillRuntimeStatus | null;
  onInstall?: (plugin: PluginMarketSkillItem) => void;
  onUninstall?: (skillId: string) => void;
  onConfigure?: (plugin: PluginMarketSkillItem) => void;
}

export function PluginCard({
  plugin,
  runtimeStatus,
  onInstall,
  onUninstall,
  onConfigure,
}: PluginCardProps) {
  const t = useTranslations("plugins");
  const color = pickColor(plugin.id);
  const canInstall = typeof onInstall === "function";
  const canUninstall = typeof onUninstall === "function";
  const canConfigure = typeof onConfigure === "function";
  const surfaceLabel =
    runtimeStatus == null
      ? null
      : t(`runtimeLabels.executionSurface.${runtimeStatus.normalized_execution_surface}`);
  const runtimeBadge =
    runtimeStatus == null
      ? null
      : runtimeStatus.runnable_now
        ? {
            label: t("runtimeStatus.ready"),
            className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
          }
        : runtimeStatus.runtime_install_state === "installing"
          ? {
              label: t("runtimeStatus.installing"),
              className: "border-blue-500/20 bg-blue-500/10 text-blue-700",
            }
          : runtimeStatus.runtime_install_supported &&
              runtimeStatus.runtime_install_state === "install_failed"
            ? {
                label: t("runtimeStatus.installFailed"),
                className: "border-red-500/20 bg-red-500/10 text-red-700",
              }
            : runtimeStatus.runtime_install_supported &&
                runtimeStatus.runtime_install_state !== "ready"
              ? {
                  label: t("runtimeStatus.installRequired"),
                  className: "border-amber-500/20 bg-amber-500/10 text-amber-700",
                }
              : runtimeStatus.missing_bins.length > 0
                ? {
                    label: t("runtimeStatus.missingBin"),
                    className: "border-amber-500/20 bg-amber-500/10 text-amber-700",
                  }
                : runtimeStatus.missing_env.length > 0
                  ? {
                      label: t("runtimeStatus.missingEnv"),
                      className: "border-amber-500/20 bg-amber-500/10 text-amber-700",
                    }
                  : runtimeStatus.missing_config.length > 0
                    ? {
                        label: t("runtimeStatus.missingConfig"),
                        className: "border-blue-500/20 bg-blue-500/10 text-blue-700",
                      }
                    : {
                        label: t("runtimeStatus.docsOnly"),
                        className: "border-border bg-muted text-muted-foreground",
                      };

  return (
    <Card className="group h-full overflow-hidden border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_94%,transparent)] py-0 shadow-none transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--hairline-strong)]">
      <div className={cn("h-1.5 w-full bg-gradient-to-r", color)} />

      <CardHeader className="gap-4 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-12 rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]">
              <AvatarFallback className="rounded-2xl bg-transparent text-[var(--ink)]">
                <Workflow className="size-5" />
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-[var(--ink)]">
                {plugin.name}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--ink-3)]">
                {plugin.id}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={plugin.status === "active" ? "default" : "secondary"}
              className="text-[10px] uppercase tracking-[0.14em]"
            >
              {t(`status.${plugin.status}`)}
            </Badge>
            {runtimeBadge ? (
              <Badge variant="outline" className={cn("text-[10px]", runtimeBadge.className)}>
                {runtimeBadge.label}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 px-5 pb-5">
        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-[var(--ink-2)]">
          {plugin.description || t("card.noDescription")}
        </p>

        <div className="grid gap-2 rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3 text-xs text-[var(--ink-2)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--ink-3)]">{t("page.skills.surfaceLabel")}</span>
            <span className="truncate font-medium text-[var(--ink)]">
              {surfaceLabel ?? t("runtimeStatus.docsOnly")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--ink-3)]">{t("page.skills.versionLabel")}</span>
            <span className="truncate font-mono text-[var(--ink)]">
              {plugin.version ?? runtimeStatus?.installed_version ?? "—"}
            </span>
          </div>
        </div>

        {runtimeStatus && !runtimeStatus.runnable_now ? (
          <p className="text-xs leading-5 text-[var(--ink-3)]">
            {runtimeStatus.blocking_reason
              ? t(`runtimeStatus.reason.${runtimeStatus.blocking_reason}`)
              : t("runtimeStatus.reason.unknown")}
          </p>
        ) : null}

        {runtimeStatus?.runtime_install_error && !runtimeStatus.runnable_now ? (
          <p
            className="line-clamp-3 text-[11px] break-words text-destructive"
            title={runtimeStatus.runtime_install_error}
          >
            {runtimeStatus.runtime_install_error}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="mt-auto justify-between gap-3 border-t border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg-inset)_84%,transparent)] px-5 py-4">
        <div className="flex items-center gap-1.5 text-xs text-[var(--ink-3)]">
          <Shield className="size-3.5" />
          <span>
            {runtimeStatus && !runtimeStatus.runnable_now
              ? t("card.missingRuntime")
              : t("card.permissions")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {plugin.installed && runtimeStatus && canConfigure ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => onConfigure?.(plugin)}
            >
              <Settings2 className="size-3.5" />
              {t("card.configure")}
            </Button>
          ) : null}

          {plugin.installed && canUninstall ? (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-[var(--ink-2)] hover:text-destructive"
              onClick={() => onUninstall?.(plugin.id)}
            >
              <Trash2 className="size-3.5" />
              {t("card.uninstall")}
            </Button>
          ) : null}

          {!plugin.installed && canInstall ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => onInstall?.(plugin)}
            >
              {t("card.install")}
            </Button>
          ) : null}
        </div>
      </CardFooter>
    </Card>
  );
}
