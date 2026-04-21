"use client";

import * as React from "react";
import { Loader2, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import type {
  LocalSkillRuntimeStatus,
  PluginMarketSkillItem,
} from "@/lib/api/plugin-market";

interface SkillRuntimeConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: PluginMarketSkillItem | null;
  runtimeStatus: LocalSkillRuntimeStatus | null;
  isSaving?: boolean;
  isInstallingRuntime?: boolean;
  onSave: (payload: {
    env_json: Record<string, string>;
    config_json: Record<string, unknown>;
  }) => void;
  onInstallRuntime?: () => void;
}

export function SkillRuntimeConfigSheet({
  open,
  onOpenChange,
  plugin,
  runtimeStatus,
  isSaving = false,
  isInstallingRuntime = false,
  onSave,
  onInstallRuntime,
}: SkillRuntimeConfigSheetProps) {
  const t = useTranslations("plugins");
  const [envDraft, setEnvDraft] = React.useState<Record<string, string>>({});
  const [configDraft, setConfigDraft] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open || !runtimeStatus) {
      return;
    }

    setEnvDraft(runtimeStatus.current_env);
    setConfigDraft(
      Object.fromEntries(
        Object.entries(runtimeStatus.current_config).map(([key, value]) => [
          key,
          typeof value === "string" ? value : JSON.stringify(value),
        ])
      )
    );
  }, [open, runtimeStatus]);

  const handleSave = React.useCallback(() => {
    const parsedConfig = Object.fromEntries(
      Object.entries(configDraft)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value.length > 0)
        .map(([key, value]) => {
          try {
            return [key, JSON.parse(value)] as const;
          } catch {
            return [key, value] as const;
          }
        })
    );
    const parsedEnv = Object.fromEntries(
      Object.entries(envDraft)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value.length > 0)
    );

    onSave({
      env_json: parsedEnv,
      config_json: parsedConfig,
    });
  }, [configDraft, envDraft, onSave]);

  const pluginName = plugin?.name ?? runtimeStatus?.display_name ?? "-";
  const executionSurfaceLabel = runtimeStatus
    ? t(`runtimeLabels.executionSurface.${runtimeStatus.normalized_execution_surface}`)
    : "-";
  const adapterKindLabel = runtimeStatus
    ? t(`runtimeLabels.adapterKind.${runtimeStatus.adapter_kind}`)
    : "-";
  const isRuntimeInstalling =
    isInstallingRuntime || runtimeStatus?.runtime_install_state === "installing";
  const canInstallRuntime =
    Boolean(runtimeStatus?.runtime_install_supported) &&
    runtimeStatus?.runtime_install_state !== "ready";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t("runtimeConfig.title", { name: pluginName })}
          </SheetTitle>
          <SheetDescription>{t("runtimeConfig.description")}</SheetDescription>
        </SheetHeader>

        {!runtimeStatus ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {t("runtimeConfig.noRuntimeStatus")}
          </div>
        ) : (
          <div className="space-y-6 px-4 py-6">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div>{t("runtimeConfig.executionSurface", { surface: executionSurfaceLabel })}</div>
              <div>{t("runtimeConfig.adapterKind", { adapter: adapterKindLabel })}</div>
              <div>{t("runtimeConfig.ecosystem", { ecosystem: runtimeStatus.ecosystem })}</div>
              <div>{t("runtimeConfig.executionMode", { mode: runtimeStatus.execution_mode })}</div>
              {runtimeStatus.runtime_kind ? (
                <div>{t("runtimeConfig.runtimeKind", { kind: runtimeStatus.runtime_kind })}</div>
              ) : null}
              {runtimeStatus.runtime_install_supported ? (
                <div>
                  {t("runtimeConfig.runtimeManager", {
                    manager: runtimeStatus.runtime_install_manager ?? "unknown",
                  })}
                </div>
              ) : null}
              <div>
                {runtimeStatus.runnable_now
                  ? t("runtimeStatus.ready")
                  : t(`runtimeStatus.reason.${runtimeStatus.blocking_reason ?? "unknown"}`)}
              </div>
            </div>

            {runtimeStatus.runtime_install_supported ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-medium">{t("runtimeConfig.runtimeSection")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t(`runtimeConfig.installState.${runtimeStatus.runtime_install_state}`)}
                </p>
                {runtimeStatus.runtime_install_error ? (
                  <p className="whitespace-pre-wrap break-words text-xs text-destructive">
                    {runtimeStatus.runtime_install_error}
                  </p>
                ) : null}
                {runtimeStatus.runtime_command_path ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {t("runtimeConfig.commandPath", {
                      path: runtimeStatus.runtime_command_path,
                    })}
                  </p>
                ) : null}
                {runtimeStatus.runtime_dependency_manifest_path ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {t("runtimeConfig.dependencyManifestPath", {
                      path: runtimeStatus.runtime_dependency_manifest_path,
                    })}
                  </p>
                ) : null}
                {canInstallRuntime ? (
                  <Button
                    variant="outline"
                    onClick={onInstallRuntime}
                    disabled={isRuntimeInstalling || !runtimeStatus.runtime_manager_available}
                  >
                    {isRuntimeInstalling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isRuntimeInstalling
                      ? t("runtimeConfig.installingRuntime")
                      : t("runtimeConfig.installRuntime")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {runtimeStatus.missing_bins.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("runtimeConfig.binSection")}</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {runtimeStatus.required_bins.map((item) => (
                    <li key={item}>
                      {runtimeStatus.missing_bins.includes(item)
                        ? t("runtimeConfig.binMissing", { name: item })
                        : t("runtimeConfig.binReady", { name: item })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("runtimeConfig.envSection")}</h3>
              {runtimeStatus.required_env.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("runtimeConfig.noEnvRequired")}</p>
              ) : (
                runtimeStatus.required_env.map((item) => (
                  <div key={item.key} className="space-y-1.5">
                    <Label htmlFor={`env-${item.key}`}>{item.key}</Label>
                    <Input
                      id={`env-${item.key}`}
                      type="password"
                      value={envDraft[item.key] ?? ""}
                      onChange={(event) =>
                        setEnvDraft((current) => ({ ...current, [item.key]: event.target.value }))
                      }
                      placeholder={t("runtimeConfig.envPlaceholder")}
                    />
                    <p className="text-xs text-muted-foreground">
                      {item.configured
                        ? t("runtimeConfig.configured", { source: item.source ?? "unknown" })
                        : t("runtimeConfig.missing")}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("runtimeConfig.configSection")}</h3>
              {runtimeStatus.required_config.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("runtimeConfig.noConfigRequired")}
                </p>
              ) : (
                runtimeStatus.required_config.map((item) => (
                  <div key={item.key} className="space-y-1.5">
                    <Label htmlFor={`config-${item.key}`}>{item.key}</Label>
                    <Input
                      id={`config-${item.key}`}
                      value={configDraft[item.key] ?? ""}
                      onChange={(event) =>
                        setConfigDraft((current) => ({
                          ...current,
                          [item.key]: event.target.value,
                        }))
                      }
                      placeholder={t("runtimeConfig.configPlaceholder")}
                    />
                    <p className="text-xs text-muted-foreground">
                      {item.configured
                        ? t("runtimeConfig.configured", { source: item.source ?? "unknown" })
                        : t("runtimeConfig.missing")}
                    </p>
                  </div>
                ))
              )}
            </div>

            {runtimeStatus.install_hints.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t("runtimeConfig.installHints")}</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {runtimeStatus.install_hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!runtimeStatus || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? t("runtimeConfig.saving") : t("runtimeConfig.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
