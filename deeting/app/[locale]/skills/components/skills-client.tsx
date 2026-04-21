"use client";

import * as React from "react";
import { Laptop, RefreshCw, Search, ShieldCheck, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PluginCard } from "@/components/plugins/plugin-card";
import { SkillRuntimeConfigSheet } from "@/components/plugins/skill-runtime-config-sheet";
import { Button } from "@/components/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card";
import { Input } from "@/components/ui/shadcn/input";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { useLocalSkillRuntimeStatuses } from "@/hooks/use-local-skill-runtime-statuses";
import {
  installLocalSkillRuntime,
  isDesktopRuntime,
  uninstallPlugin,
  updateLocalSkillRuntimeSettings,
  type LocalSkillRuntimeStatus,
  type PluginMarketSkillItem,
} from "@/lib/api/plugin-market";

function buildLocalSkillItem(status: LocalSkillRuntimeStatus): PluginMarketSkillItem {
  return {
    id: status.skill_id,
    name: status.display_name,
    description: null,
    version: status.installed_version ?? null,
    source_repo: null,
    source_revision: null,
    source_kind: "local",
    status: status.is_enabled ? "active" : "disabled",
    installed: true,
    created_at: null,
    updated_at: null,
    compatibility: status.compatibility,
  };
}

function sortSkills(left: LocalSkillRuntimeStatus, right: LocalSkillRuntimeStatus) {
  if (left.runnable_now !== right.runnable_now) {
    return left.runnable_now ? -1 : 1;
  }

  if (left.is_enabled !== right.is_enabled) {
    return left.is_enabled ? -1 : 1;
  }

  return left.display_name.localeCompare(right.display_name, "zh-CN");
}

export function SkillsClient() {
  const t = useTranslations("plugins");
  const tCommon = useTranslations("common");
  const [desktopSupport, setDesktopSupport] = React.useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const debouncedQuery = useDebounce(searchQuery, 200);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [configSheetOpen, setConfigSheetOpen] = React.useState(false);
  const [isSavingRuntimeConfig, setIsSavingRuntimeConfig] = React.useState(false);
  const [isInstallingRuntime, setIsInstallingRuntime] = React.useState(false);

  React.useEffect(() => {
    setDesktopSupport(isDesktopRuntime());
  }, []);

  const {
    runtimeStatuses,
    isLoadingRuntimeStatuses,
    refreshRuntimeStatuses,
  } = useLocalSkillRuntimeStatuses(desktopSupport);

  const skillStatuses = React.useMemo(
    () => Object.values(runtimeStatuses).sort(sortSkills),
    [runtimeStatuses]
  );

  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const visibleSkills = React.useMemo(() => {
    if (!normalizedQuery) {
      return skillStatuses;
    }

    return skillStatuses.filter((status) => {
      const haystack = [
        status.display_name,
        status.skill_id,
        status.execution_mode,
        status.normalized_execution_surface,
        status.adapter_kind,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, skillStatuses]);

  const selectedRuntimeStatus = selectedSkillId ? runtimeStatuses[selectedSkillId] ?? null : null;
  const selectedPlugin = selectedRuntimeStatus ? buildLocalSkillItem(selectedRuntimeStatus) : null;

  const stats = React.useMemo(() => {
    const installedCount = skillStatuses.length;
    const runnableCount = skillStatuses.filter((item) => item.runnable_now).length;
    const actionRequiredCount = skillStatuses.filter((item) => !item.runnable_now).length;

    return [
      {
        key: "installed",
        title: t("page.skills.stats.installed"),
        value: installedCount,
        icon: Laptop,
      },
      {
        key: "ready",
        title: t("page.skills.stats.ready"),
        value: runnableCount,
        icon: ShieldCheck,
      },
      {
        key: "actionRequired",
        title: t("page.skills.stats.actionRequired"),
        value: actionRequiredCount,
        icon: Wrench,
      },
    ];
  }, [skillStatuses, t]);

  const openConfig = React.useCallback((plugin: PluginMarketSkillItem) => {
    setSelectedSkillId(plugin.id);
    setConfigSheetOpen(true);
  }, []);

  const handleSaveRuntimeConfig = React.useCallback(
    async (payload: { env_json: Record<string, string>; config_json: Record<string, unknown> }) => {
      if (!selectedRuntimeStatus) {
        return;
      }

      setIsSavingRuntimeConfig(true);
      try {
        await updateLocalSkillRuntimeSettings(selectedRuntimeStatus.skill_id, payload);
        await refreshRuntimeStatuses();
        toast.success(t("runtimeConfig.savedTitle"), {
          description: t("runtimeConfig.savedDesc"),
        });
        setConfigSheetOpen(false);
      } catch {
        toast.error(t("runtimeConfig.saveFailedTitle"), {
          description: t("runtimeConfig.saveFailedDesc"),
        });
      } finally {
        setIsSavingRuntimeConfig(false);
      }
    },
    [refreshRuntimeStatuses, selectedRuntimeStatus, t]
  );

  const handleInstallRuntime = React.useCallback(async () => {
    if (!selectedRuntimeStatus) {
      return;
    }

    setIsInstallingRuntime(true);
    try {
      await installLocalSkillRuntime(selectedRuntimeStatus.skill_id);
      await refreshRuntimeStatuses();
      toast.success(t("runtimeConfig.installRuntimeStartedTitle"), {
        description: t("runtimeConfig.installRuntimeStartedDesc"),
      });
    } catch (error) {
      const description =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t("runtimeConfig.installRuntimeFailedDesc");
      toast.error(t("runtimeConfig.installRuntimeFailedTitle"), {
        description,
      });
      await refreshRuntimeStatuses();
    } finally {
      setIsInstallingRuntime(false);
    }
  }, [refreshRuntimeStatuses, selectedRuntimeStatus, t]);

  const handleUninstall = React.useCallback(
    async (skillId: string) => {
      try {
        await uninstallPlugin(skillId);
        await refreshRuntimeStatuses();
        toast.success(t("toast.uninstalledTitle"), {
          description: t("toast.uninstalledDesc"),
        });
        if (selectedSkillId === skillId) {
          setConfigSheetOpen(false);
          setSelectedSkillId(null);
        }
      } catch {
        toast.error(t("toast.uninstallFailedTitle"), {
          description: t("toast.uninstallFailedDesc"),
        });
      }
    },
    [refreshRuntimeStatuses, selectedSkillId, t]
  );

  if (desktopSupport === false) {
    return (
      <Card className="border-[var(--hairline)] bg-[var(--panel-bg)] shadow-none">
        <CardHeader>
          <CardTitle>{t("page.skills.desktopOnlyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-[var(--ink-2)]">
          {t("page.skills.desktopOnlyDescription")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <Card className="border-[var(--hairline)] bg-[var(--panel-bg)] shadow-none">
          <CardHeader className="gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-3)]">
              {t("page.skills.eyebrow")}
            </div>
            <CardTitle className="text-2xl tracking-[-0.04em] text-[var(--ink)]">
              {tCommon("nav.skills")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-[var(--ink-2)]">
            <p>{t("page.skills.description")}</p>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("page.skills.searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--hairline)] bg-[var(--panel-bg)] shadow-none">
          <CardHeader className="gap-3">
            <CardTitle className="text-base text-[var(--ink)]">
              {t("page.skills.summaryTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-[12px] bg-[var(--panel-bg)] text-[var(--ink)]">
                      <Icon className="size-4" />
                    </div>
                    <div className="text-sm text-[var(--ink-2)]">{item.title}</div>
                  </div>
                  <div className="font-mono text-lg text-[var(--ink)]">{item.value}</div>
                </div>
              );
            })}

            <Button
              variant="outline"
              className="w-full justify-center rounded-full"
              onClick={() => void refreshRuntimeStatuses()}
            >
              <RefreshCw className="size-4" />
              {t("page.skills.refresh")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {desktopSupport === null || (isLoadingRuntimeStatuses && skillStatuses.length === 0)
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card
                key={`skill-skeleton-${index}`}
                className="border-[var(--hairline)] bg-[var(--panel-bg)] py-0 shadow-none"
              >
                <div className="h-1.5 w-full bg-[var(--panel-bg-inset)]" />
                <CardHeader className="gap-4 px-5 pb-4 pt-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-5 pb-5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-20 w-full rounded-2xl" />
                </CardContent>
              </Card>
            ))
          : visibleSkills.length === 0 ? (
              <Card className="col-span-full border-[var(--hairline)] bg-[var(--panel-bg)] shadow-none">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Laptop className="size-12 text-[var(--ink-3)]" />
                  <div className="text-lg font-semibold text-[var(--ink)]">
                    {t("page.emptyInstalled.title")}
                  </div>
                  <p className="max-w-xl text-sm leading-6 text-[var(--ink-2)]">
                    {normalizedQuery
                      ? t("page.skills.noSearchResults")
                      : t("page.emptyInstalled.description")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              visibleSkills.map((status) => {
                const plugin = buildLocalSkillItem(status);
                return (
                  <PluginCard
                    key={status.skill_id}
                    plugin={plugin}
                    runtimeStatus={status}
                    onConfigure={openConfig}
                    onUninstall={handleUninstall}
                  />
                );
              })
            )}
      </section>

      <SkillRuntimeConfigSheet
        open={configSheetOpen}
        onOpenChange={setConfigSheetOpen}
        plugin={selectedPlugin}
        runtimeStatus={selectedRuntimeStatus}
        isSaving={isSavingRuntimeConfig}
        isInstallingRuntime={isInstallingRuntime}
        onSave={handleSaveRuntimeConfig}
        onInstallRuntime={handleInstallRuntime}
      />
    </div>
  );
}
