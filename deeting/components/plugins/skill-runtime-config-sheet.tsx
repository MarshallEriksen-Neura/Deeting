"use client";

import * as React from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleDot,
  Cpu,
  FileCode2,
  KeyRound,
  Layers,
  Loader2,
  Plug,
  Settings2,
  Sliders,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { cn } from "@/lib/utils";
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

interface MetaRow {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
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

  const metaRows: MetaRow[] = React.useMemo(() => {
    if (!runtimeStatus) return [];
    const rows: MetaRow[] = [
      {
        key: "executionSurface",
        icon: Sparkles,
        label: t("runtimeConfig.executionSurface", { surface: "" }).replace(/[:：]\s*$/, ""),
        value: executionSurfaceLabel,
      },
      {
        key: "adapterKind",
        icon: Plug,
        label: t("runtimeConfig.adapterKind", { adapter: "" }).replace(/[:：]\s*$/, ""),
        value: adapterKindLabel,
      },
      {
        key: "ecosystem",
        icon: Boxes,
        label: t("runtimeConfig.ecosystem", { ecosystem: "" }).replace(/[:：]\s*$/, ""),
        value: runtimeStatus.ecosystem,
      },
      {
        key: "executionMode",
        icon: Layers,
        label: t("runtimeConfig.executionMode", { mode: "" }).replace(/[:：]\s*$/, ""),
        value: runtimeStatus.execution_mode,
      },
    ];
    if (runtimeStatus.runtime_kind) {
      rows.push({
        key: "runtimeKind",
        icon: Cpu,
        label: t("runtimeConfig.runtimeKind", { kind: "" }).replace(/[:：]\s*$/, ""),
        value: runtimeStatus.runtime_kind,
      });
    }
    if (runtimeStatus.runtime_install_supported) {
      rows.push({
        key: "runtimeManager",
        icon: Wrench,
        label: t("runtimeConfig.runtimeManager", { manager: "" }).replace(/[:：]\s*$/, ""),
        value: runtimeStatus.runtime_install_manager ?? "unknown",
      });
    }
    return rows;
  }, [runtimeStatus, executionSurfaceLabel, adapterKindLabel, t]);

  const isReady = Boolean(runtimeStatus?.runnable_now);
  const statusLabel = runtimeStatus
    ? isReady
      ? t("runtimeStatus.ready")
      : t(`runtimeStatus.reason.${runtimeStatus.blocking_reason ?? "unknown"}`)
    : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* Header */}
        <SheetHeader className="relative gap-0 border-b bg-gradient-to-br from-primary/[0.06] via-background to-background px-6 pb-5 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Settings2 className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <SheetTitle className="truncate text-[15px] font-semibold leading-tight">
                {t("runtimeConfig.title", { name: pluginName })}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed">
                {t("runtimeConfig.description")}
              </SheetDescription>
            </div>
          </div>
          {runtimeStatus ? (
            <div
              className={cn(
                "mt-4 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur",
                isReady
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}
            >
              <span
                className={cn(
                  "relative flex h-1.5 w-1.5",
                  isReady ? "text-emerald-500" : "text-amber-500"
                )}
              >
                {isReady ? (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                ) : null}
                <span
                  className={cn(
                    "relative inline-flex h-1.5 w-1.5 rounded-full",
                    isReady ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
              </span>
              <span className="leading-none">{statusLabel}</span>
            </div>
          ) : null}
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!runtimeStatus ? (
            <div className="flex h-full items-center justify-center px-6 py-12">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("runtimeConfig.noRuntimeStatus")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 px-6 py-5">
              {/* Metadata card */}
              {metaRows.length > 0 ? (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <ul className="divide-y">
                    {metaRows.map((row) => {
                      const Icon = row.icon;
                      return (
                        <li
                          key={row.key}
                          className="flex items-center gap-3 px-3.5 py-2.5"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {row.label}
                          </span>
                          <span className="ml-auto truncate text-right text-xs font-medium text-foreground">
                            {row.value}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {/* Runtime environment */}
              {runtimeStatus.runtime_install_supported ? (
                <Section
                  icon={Terminal}
                  title={t("runtimeConfig.runtimeSection")}
                >
                  <div className="space-y-3">
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-3 py-2.5",
                        runtimeStatus.runtime_install_state === "ready"
                          ? "border-emerald-500/20 bg-emerald-500/[0.06]"
                          : runtimeStatus.runtime_install_state === "install_failed"
                            ? "border-destructive/25 bg-destructive/[0.06]"
                            : "border-border/70 bg-muted/30"
                      )}
                    >
                      {runtimeStatus.runtime_install_state === "ready" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      ) : runtimeStatus.runtime_install_state === "install_failed" ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {t(`runtimeConfig.installState.${runtimeStatus.runtime_install_state}`)}
                      </p>
                    </div>

                    {runtimeStatus.runtime_install_error ? (
                      <p className="whitespace-pre-wrap break-words rounded-md bg-destructive/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive">
                        {runtimeStatus.runtime_install_error}
                      </p>
                    ) : null}

                    {runtimeStatus.runtime_command_path ? (
                      <PathRow
                        icon={Terminal}
                        label={t("runtimeConfig.commandPath", { path: "" }).replace(
                          /[:：]\s*$/,
                          ""
                        )}
                        value={runtimeStatus.runtime_command_path}
                      />
                    ) : null}
                    {runtimeStatus.runtime_dependency_manifest_path ? (
                      <PathRow
                        icon={FileCode2}
                        label={t("runtimeConfig.dependencyManifestPath", {
                          path: "",
                        }).replace(/[:：]\s*$/, "")}
                        value={runtimeStatus.runtime_dependency_manifest_path}
                      />
                    ) : null}

                    {canInstallRuntime ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={onInstallRuntime}
                        disabled={
                          isRuntimeInstalling || !runtimeStatus.runtime_manager_available
                        }
                      >
                        {isRuntimeInstalling ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wrench className="mr-2 h-3.5 w-3.5" />
                        )}
                        {isRuntimeInstalling
                          ? t("runtimeConfig.installingRuntime")
                          : t("runtimeConfig.installRuntime")}
                      </Button>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {/* Bins */}
              {runtimeStatus.missing_bins.length > 0 ? (
                <Section icon={Boxes} title={t("runtimeConfig.binSection")}>
                  <ul className="space-y-1.5">
                    {runtimeStatus.required_bins.map((item) => {
                      const missing = runtimeStatus.missing_bins.includes(item);
                      return (
                        <li
                          key={item}
                          className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs"
                        >
                          {missing ? (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          )}
                          <span className="font-mono text-foreground">{item}</span>
                          <span className="ml-auto text-muted-foreground">
                            {missing
                              ? t("runtimeStatus.missingBin")
                              : t("runtimeStatus.ready")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              ) : null}

              {/* Env */}
              <Section icon={KeyRound} title={t("runtimeConfig.envSection")}>
                {runtimeStatus.required_env.length === 0 ? (
                  <EmptyDeclared
                    label={t("runtimeConfig.noEnvRequired")}
                  />
                ) : (
                  <div className="space-y-3">
                    {runtimeStatus.required_env.map((item) => (
                      <div key={item.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`env-${item.key}`}
                            className="font-mono text-xs"
                          >
                            {item.key}
                          </Label>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              item.configured
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {item.configured
                              ? t("runtimeConfig.configured", {
                                  source: item.source ?? "unknown",
                                })
                              : t("runtimeConfig.missing")}
                          </span>
                        </div>
                        <Input
                          id={`env-${item.key}`}
                          type="password"
                          value={envDraft[item.key] ?? ""}
                          onChange={(event) =>
                            setEnvDraft((current) => ({
                              ...current,
                              [item.key]: event.target.value,
                            }))
                          }
                          placeholder={t("runtimeConfig.envPlaceholder")}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Config */}
              <Section icon={Sliders} title={t("runtimeConfig.configSection")}>
                {runtimeStatus.required_config.length === 0 ? (
                  <EmptyDeclared
                    label={t("runtimeConfig.noConfigRequired")}
                  />
                ) : (
                  <div className="space-y-3">
                    {runtimeStatus.required_config.map((item) => (
                      <div key={item.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`config-${item.key}`}
                            className="font-mono text-xs"
                          >
                            {item.key}
                          </Label>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              item.configured
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {item.configured
                              ? t("runtimeConfig.configured", {
                                  source: item.source ?? "unknown",
                                })
                              : t("runtimeConfig.missing")}
                          </span>
                        </div>
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
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Install hints */}
              {runtimeStatus.install_hints.length > 0 ? (
                <Section icon={Sparkles} title={t("runtimeConfig.installHints")}>
                  <ul className="space-y-1.5">
                    {runtimeStatus.install_hints.map((hint) => (
                      <li
                        key={hint}
                        className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground"
                      >
                        <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-primary/60" />
                        <span>{hint}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!runtimeStatus || isSaving}
            className="min-w-[96px]"
          >
            {isSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {isSaving ? t("runtimeConfig.saving") : t("runtimeConfig.save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function PathRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="break-all rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/90">
        {value}
      </div>
    </div>
  );
}

function EmptyDeclared({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3.5 py-3 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
      <span className="leading-relaxed">{label}</span>
    </div>
  );
}
