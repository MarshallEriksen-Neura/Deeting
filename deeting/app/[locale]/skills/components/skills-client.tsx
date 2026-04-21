"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Laptop, RefreshCw, Search, ShieldCheck, Wrench, Filter, Grid2X2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PluginCard } from "@/components/plugins/plugin-card";
import { SkillRuntimeConfigSheet } from "@/components/plugins/skill-runtime-config-sheet";
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
import { cn } from "@/lib/utils";

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
  const [activeFilter, setActiveFilter] = React.useState<"all" | "ready" | "action">("all");
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
  
  const stats = React.useMemo(() => {
    return {
      total: skillStatuses.length,
      ready: skillStatuses.filter(s => s.runnable_now).length,
      action: skillStatuses.filter(s => !s.runnable_now).length,
    };
  }, [skillStatuses]);

  const filteredSkills = React.useMemo(() => {
    let result = skillStatuses;
    
    if (activeFilter === "ready") result = result.filter(s => s.runnable_now);
    if (activeFilter === "action") result = result.filter(s => !s.runnable_now);

    if (normalizedQuery) {
      result = result.filter((status) => {
        const haystack = [status.display_name, status.skill_id, status.execution_mode].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      });
    }
    return result;
  }, [normalizedQuery, skillStatuses, activeFilter]);

  const selectedRuntimeStatus = selectedSkillId ? runtimeStatuses[selectedSkillId] ?? null : null;
  const selectedPlugin = selectedRuntimeStatus ? buildLocalSkillItem(selectedRuntimeStatus) : null;

  const openConfig = React.useCallback((plugin: PluginMarketSkillItem) => {
    setSelectedSkillId(plugin.id);
    setConfigSheetOpen(true);
  }, []);

  const handleSaveRuntimeConfig = React.useCallback(
    async (payload: { env_json: Record<string, string>; config_json: Record<string, unknown> }) => {
      if (!selectedRuntimeStatus) return;
      setIsSavingRuntimeConfig(true);
      try {
        await updateLocalSkillRuntimeSettings(selectedRuntimeStatus.skill_id, payload);
        await refreshRuntimeStatuses();
        toast.success(t("runtimeConfig.savedTitle"));
        setConfigSheetOpen(false);
      } catch {
        toast.error(t("runtimeConfig.saveFailedTitle"));
      } finally {
        setIsSavingRuntimeConfig(false);
      }
    },
    [refreshRuntimeStatuses, selectedRuntimeStatus, t]
  );

  const handleInstallRuntime = React.useCallback(async () => {
    if (!selectedRuntimeStatus) return;
    setIsInstallingRuntime(true);
    try {
      await installLocalSkillRuntime(selectedRuntimeStatus.skill_id);
      await refreshRuntimeStatuses();
      toast.success(t("runtimeConfig.installRuntimeStartedTitle"));
    } catch (error) {
      toast.error(t("runtimeConfig.installRuntimeFailedTitle"));
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
        toast.success(t("toast.uninstalledTitle"));
      } catch {
        toast.error(t("toast.uninstallFailedTitle"));
      }
    },
    [refreshRuntimeStatuses, t]
  );

  if (desktopSupport === false) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-8 bg-[var(--panel-bg)] rounded-[18px] border border-[var(--hairline)]">
        <Laptop className="size-12 text-[var(--ink-4)] mb-4" />
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t("page.skills.desktopOnlyTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--ink-3)] max-w-md">{t("page.skills.desktopOnlyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-5">
      {/* Workspace Header Toolbar */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-[17px] font-[600] tracking-[-0.2px] text-[var(--ink)] flex items-center gap-2">
              <Grid2X2 size={18} className="text-[var(--accent)]" />
              {tCommon("nav.skills")}
            </h1>
            <div className="h-4 w-px bg-[var(--hairline)] hidden lg:block" />
          </div>
          <div className="flex w-full max-w-fit flex-wrap items-center gap-1.5 bg-[var(--panel-bg-inset)] p-1 rounded-[10px] ring-1 ring-[var(--hairline)] shadow-sm">
             {[
               { id: "all", label: t("page.skills.stats.installed"), count: stats.total, icon: Grid2X2 },
               { id: "ready", label: t("page.skills.stats.ready"), count: stats.ready, icon: ShieldCheck, color: "text-[var(--ok)]" },
               { id: "action", label: t("page.skills.stats.actionRequired"), count: stats.action, icon: Wrench, color: "text-[var(--warn)]" },
             ].map(filter => (
               <button
                 key={filter.id}
                 onClick={() => setActiveFilter(filter.id as any)}
                 className={cn(
                   "flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-[12px] font-[500] transition-all",
                   activeFilter === filter.id 
                    ? "bg-[var(--panel-bg)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--hairline-strong)]" 
                    : "text-[var(--ink-3)] hover:text-[var(--ink)]"
                 )}
               >
                 <filter.icon size={13} className={cn(activeFilter === filter.id ? filter.color : "text-current")} />
                 {filter.label}
                 <span className="font-mono tabular-nums opacity-60 ml-0.5">{filter.count}</span>
               </button>
             ))}
          </div>
        </div>

        <div className="flex w-full items-center gap-3 xl:w-auto xl:justify-end xl:self-start">
          <div className="relative min-w-0 flex-1 xl:w-[360px] xl:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--ink-4)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("page.skills.searchPlaceholder")}
              className="w-full h-[32px] pl-8 pr-3 text-[13px] bg-[var(--panel-bg-inset)] rounded-[8px] ring-1 ring-[var(--hairline)] focus:ring-[var(--hairline-strong)] outline-none transition-all placeholder:text-[var(--ink-4)]"
            />
          </div>
          <button
            onClick={() => refreshRuntimeStatuses()}
            className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--panel-bg-inset)] transition-all ring-1 ring-transparent hover:ring-[var(--hairline)]"
          >
            <RefreshCw size={14} className={isLoadingRuntimeStatuses ? "animate-spin text-[var(--accent)]" : ""} />
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
        <motion.div 
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {isLoadingRuntimeStatuses && skillStatuses.length === 0 ? (
               Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[180px] rounded-[18px] bg-[var(--panel-bg-inset)] border border-[var(--hairline)] animate-pulse" />
              ))
            ) : filteredSkills.length === 0 ? (
              <div className="col-span-full py-20 flex flex-col items-center justify-center text-center">
                <div className="size-16 rounded-full bg-[var(--panel-bg-inset)] flex items-center justify-center mb-4 ring-1 ring-[var(--hairline)]">
                   <Grid2X2 size={24} className="text-[var(--ink-4)]" />
                </div>
                <h3 className="text-[15px] font-[600] text-[var(--ink)]">{t("page.emptyInstalled.title")}</h3>
                <p className="text-[13px] text-[var(--ink-3)] mt-1">{t("page.emptyInstalled.description")}</p>
              </div>
            ) : (
              filteredSkills.map((status) => (
                <PluginCard
                  key={status.skill_id}
                  plugin={buildLocalSkillItem(status)}
                  runtimeStatus={status}
                  onConfigure={openConfig}
                  onUninstall={handleUninstall}
                />
              ))
            )}
          </AnimatePresence>
        </motion.div>
      </div>

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
