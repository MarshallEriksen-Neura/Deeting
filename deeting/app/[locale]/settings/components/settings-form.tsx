"use client";

import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { AlertTriangle, Wrench } from "lucide-react";
import { Form } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { GlassButton } from "@/components/ui/glass-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import {
  LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT,
  rebuildLocalEmbeddingAssets,
  type LocalEmbeddingRebuildProgressPayload,
  type LocalEmbeddingRebuildResponse,
} from "@/lib/api/local-embedding-rebuild";
import { runLocalMaintenanceAction } from "@/lib/api/desktop-system-assets";
import {
  updateUserSecretary,
  type UserSecretaryUpdate,
} from "@/lib/api/secretary";
import { updateUserEmbeddingConfig } from "@/lib/api/user-embedding-config";
import {
  useUserEmbeddingConfig,
  useUserSecretary,
} from "@/lib/swr/use-embedding-settings";
import { DesktopEmbeddingSettingsCard } from "./desktop-embedding-settings-card";
import { PersonalSettingsCard } from "./personal-settings-card";
import { SettingsFormActions } from "./settings-form-actions";
import { SettingsNav, type SettingsSection } from "./settings-nav";
import { type ModelGroup, type SettingsFormValues } from "../types";
import { isBrowserAgentPanelEnabled } from "./browser-agent-panel-flags";
import {
  DeferredAgentSettingsCard,
  DeferredDesktopBrowserAgentPanelCard,
  DeferredDesktopObjectStorageSettingsCard,
  DeferredDesktopSandboxSettingsCard,
  DeferredDesktopScoutSettingsCard,
  DeferredDesktopVersionManagementCard,
} from "./settings-lazy";

function findSelectedSecretaryModel(
  value: string | undefined,
  groups: ModelGroup[]
) {
  if (!value) return null;
  for (const group of groups) {
    for (const model of group.models) {
      if (model.id === value || model.provider_model_id === value) {
        return model;
      }
    }
  }
  return null;
}

interface SettingsFormProps {
  isAuthenticated: boolean;
  isTauriRuntime: boolean;
}

function applyFormValues(
  form: UseFormReturn<SettingsFormValues>,
  values: Partial<SettingsFormValues>
) {
  for (const [key, value] of Object.entries(values) as Array<
    [keyof SettingsFormValues, SettingsFormValues[keyof SettingsFormValues]]
  >) {
    form.setValue(key, value, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }
}

export function SettingsForm({
  isAuthenticated,
  isTauriRuntime,
}: SettingsFormProps) {
  const t = useI18n("settings");
  const isBrowserSectionVisible = isBrowserAgentPanelEnabled();
  const [activeSection, setActiveSection] =
    React.useState<SettingsSection>("models");
  const {
    data: secretarySetting,
    isLoading: isLoadingSecretary,
    mutate: mutateSecretary,
  } = useUserSecretary({ enabled: isAuthenticated });
  const {
    data: userEmbeddingConfig,
    isLoading: isLoadingUserEmbeddingConfig,
    mutate: mutateUserEmbeddingConfig,
  } = useUserEmbeddingConfig({ enabled: isAuthenticated && isTauriRuntime });

  // Fetch chat models for personal settings
  const { modelGroups: chatModelGroups, isLoadingModels: isLoadingChatModels } =
    useChatService({
      enabled: isAuthenticated,
      modelCapability: "chat",
    });
  const {
    modelGroups: embeddingModelGroups,
    isLoadingModels: isLoadingEmbeddingModels,
  } = useChatService({
    enabled: isAuthenticated,
    modelCapability: "embedding",
  });

  const [isSaving, setIsSaving] = React.useState(false);
  const [hasPendingRebuild, setHasPendingRebuild] = React.useState(false);
  const [isRebuildPromptOpen, setIsRebuildPromptOpen] = React.useState(false);
  const [isRebuilding, setIsRebuilding] = React.useState(false);
  const [rebuildProgress, setRebuildProgress] =
    React.useState<LocalEmbeddingRebuildProgressPayload | null>(null);
  const [rebuildSummary, setRebuildSummary] =
    React.useState<LocalEmbeddingRebuildResponse | null>(null);
  const [isRepairingIndexes, setIsRepairingIndexes] = React.useState(false);
  const [repairMessage, setRepairMessage] = React.useState<string | null>(null);
  const [hasLoadedDesktopScoutSettings, setHasLoadedDesktopScoutSettings] =
    React.useState(false);
  const [hasLoadedDesktopStorageSettings, setHasLoadedDesktopStorageSettings] =
    React.useState(false);

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      secretaryModel: "",
      desktopEmbeddingProviderModelId: "",
      scoutBaseUrl: "",
      objectStorageProvider: "cloudflare_r2_s3",
      objectStorageBucket: "",
      objectStorageRegion: "",
      objectStorageEndpoint: "",
      objectStoragePublicBaseUrl: "",
      objectStoragePathPrefix: "",
      objectStorageAccessKeyId: "",
      objectStorageSecretAccessKey: "",
      objectStorageIsPathStyle: false,
      objectStorageEnabled: false,
    },
  });

  const canEditPersonal = isAuthenticated;
  const canEditDesktop = isAuthenticated && isTauriRuntime;
  const canSave = isAuthenticated;
  const hasAvailableChatModels = chatModelGroups.length > 0;
  const hasAvailableEmbeddingModels = embeddingModelGroups.length > 0;

  React.useEffect(() => {
    if (!isAuthenticated) return;
    if (isLoadingSecretary) return;
    if (isTauriRuntime && isLoadingUserEmbeddingConfig) return;
    applyFormValues(form, {
        secretaryModel: isTauriRuntime
          ? (secretarySetting?.provider_model_id ?? secretarySetting?.model_name ?? "")
          : (secretarySetting?.model_name ?? ""),
        desktopEmbeddingProviderModelId: isTauriRuntime
          ? (userEmbeddingConfig?.provider_model_id ?? "")
          : "",
      });
  }, [
    form,
    isAuthenticated,
    isLoadingSecretary,
    isLoadingUserEmbeddingConfig,
    isTauriRuntime,
    secretarySetting?.provider_model_id,
    secretarySetting?.model_name,
    userEmbeddingConfig?.provider_model_id,
  ]);

  React.useEffect(() => {
    if (!isAuthenticated || !isTauriRuntime) return;
    if (activeSection !== "relay" || hasLoadedDesktopScoutSettings) return;

    let cancelled = false;
    (async () => {
      try {
        const { getDesktopScoutBaseUrl } = await import("@/lib/api/desktop-config");
        const scoutBaseUrl = await getDesktopScoutBaseUrl();
        if (cancelled) return;
        applyFormValues(form, { scoutBaseUrl });
        setHasLoadedDesktopScoutSettings(true);
      } catch (error) {
        console.warn("[desktop-settings] load scout settings failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSection,
    form,
    hasLoadedDesktopScoutSettings,
    isAuthenticated,
    isTauriRuntime,
  ]);

  React.useEffect(() => {
    if (!isAuthenticated || !isTauriRuntime) return;
    if (activeSection !== "storage" || hasLoadedDesktopStorageSettings) return;

    let cancelled = false;
    (async () => {
      try {
        const { fetchDesktopObjectStorageConfig } = await import(
          "@/lib/api/desktop-object-storage"
        );
        const objectStorageConfig = await fetchDesktopObjectStorageConfig();
        if (cancelled) return;
        applyFormValues(form, {
          objectStorageProvider: objectStorageConfig?.provider ?? "cloudflare_r2_s3",
          objectStorageBucket: objectStorageConfig?.bucket ?? "",
          objectStorageRegion: objectStorageConfig?.region ?? "",
          objectStorageEndpoint: objectStorageConfig?.endpoint ?? "",
          objectStoragePublicBaseUrl: objectStorageConfig?.public_base_url ?? "",
          objectStoragePathPrefix: objectStorageConfig?.path_prefix ?? "",
          objectStorageAccessKeyId: objectStorageConfig?.access_key_id ?? "",
          objectStorageSecretAccessKey: "",
          objectStorageIsPathStyle: objectStorageConfig?.is_path_style ?? false,
          objectStorageEnabled: objectStorageConfig?.is_enabled ?? false,
        });
        setHasLoadedDesktopStorageSettings(true);
      } catch (error) {
        console.warn("[desktop-settings] load object storage settings failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSection,
    form,
    hasLoadedDesktopStorageSettings,
    isAuthenticated,
    isTauriRuntime,
  ]);

  const handleStartRebuild = React.useCallback(async () => {
    if (!isTauriRuntime || isRebuilding) return;

    setIsRebuildPromptOpen(false);
    setIsRebuilding(true);
    setRebuildProgress({
      phase: "prepare",
      progress: 0,
      total: 0,
      processed: 0,
      indexed: 0,
      failed: 0,
      current: null,
    });

    let unlisten: (() => void) | null = null;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<LocalEmbeddingRebuildProgressPayload>(
        LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT,
        (event) => {
          setRebuildProgress(event.payload);
        },
      );

      const summary = await rebuildLocalEmbeddingAssets();
      setRebuildSummary(summary);
      setHasPendingRebuild(false);
      toast.success(
        t("toast.rebuildSuccess", {
          dimension: summary.vector_dimension,
          memoryIndexed: summary.memory_indexed,
          memoryFailed: summary.memory_failed,
          assetIndexed: summary.asset_indexed,
          assetFailed: summary.asset_failed,
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.rebuildFailed");
      toast.error(message);
    } finally {
      if (unlisten) {
        unlisten();
      }
      setIsRebuilding(false);
    }
  }, [isRebuilding, isTauriRuntime, t]);

  const handleRepairIndexes = React.useCallback(async () => {
    if (!isTauriRuntime || isRepairingIndexes) return;

    setIsRepairingIndexes(true);
    try {
      const result = await runLocalMaintenanceAction({ kind: "repair_local_index" });
      const nextMessage = result?.message?.trim() || t("toast.repairSuccess");
      setRepairMessage(nextMessage);

      if (result?.status === "success") {
        toast.success(nextMessage);
      } else {
        toast.error(nextMessage);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.repairFailed");
      setRepairMessage(message);
      toast.error(message);
    } finally {
      setIsRepairingIndexes(false);
    }
  }, [isRepairingIndexes, isTauriRuntime, t]);

  async function onSubmit(values: SettingsFormValues) {
    if (!isAuthenticated) {
      toast.error(t("toast.unauthenticated"));
      return;
    }
    if (!canSave) {
      toast.error(t("toast.noPermission"));
      return;
    }
    setIsSaving(true);
    try {
      let desktopEmbeddingChanged = false;
      let scoutSettingsChanged = false;
      let objectStorageChanged = false;

      if (canEditPersonal) {
        const secretaryPayload: UserSecretaryUpdate = {};
        const nextSecretaryModel = values.secretaryModel.trim();
        const currentSecretaryModel = isTauriRuntime
          ? (secretarySetting?.provider_model_id?.trim() ??
            secretarySetting?.model_name?.trim() ??
            "")
          : (secretarySetting?.model_name?.trim() ?? "");
        if (nextSecretaryModel !== currentSecretaryModel) {
          if (isTauriRuntime) {
            const selectedModel = findSelectedSecretaryModel(
              nextSecretaryModel,
              chatModelGroups
            );
            secretaryPayload.model_name =
              selectedModel?.id ?? (nextSecretaryModel || null);
            secretaryPayload.provider_model_id =
              selectedModel?.provider_model_id ?? null;
          } else {
            secretaryPayload.model_name = nextSecretaryModel || null;
          }
        }
        if (Object.keys(secretaryPayload).length > 0) {
          await updateUserSecretary(secretaryPayload);
        }
      }

      if (canEditDesktop) {
        const nextProviderModelId =
          values.desktopEmbeddingProviderModelId.trim();
        const currentProviderModelId =
          userEmbeddingConfig?.provider_model_id?.trim() ?? "";
        if (nextProviderModelId !== currentProviderModelId) {
          await updateUserEmbeddingConfig({
            provider_model_id: nextProviderModelId || null,
          });
          desktopEmbeddingChanged = true;
        }

        // Desktop-local settings are only meaningful in Tauri runtime.
        if (isTauriRuntime && hasLoadedDesktopScoutSettings) {
          const { getDesktopScoutBaseUrl, setDesktopScoutBaseUrl } =
            await import("@/lib/api/desktop-config");
          try {
            const currentScoutBaseUrl = (await getDesktopScoutBaseUrl()).trim();
            const nextScoutBaseUrl = values.scoutBaseUrl.trim();
            if (nextScoutBaseUrl !== currentScoutBaseUrl) {
              await setDesktopScoutBaseUrl(nextScoutBaseUrl);
              scoutSettingsChanged = true;
            }
          } catch (error) {
            console.warn(
              "[desktop-settings] update scout settings failed",
              error,
            );
          }
        }

        if (isTauriRuntime && hasLoadedDesktopStorageSettings) {
          const {
            fetchDesktopObjectStorageConfig,
            updateDesktopObjectStorageConfig,
          } = await import("@/lib/api/desktop-object-storage");
          try {
            const currentObjectStorage =
              await fetchDesktopObjectStorageConfig();

            const nextObjectStorageProvider = values.objectStorageProvider;
            const nextObjectStorageBucket = values.objectStorageBucket.trim();
            const nextObjectStorageRegion = values.objectStorageRegion.trim();
            const nextObjectStorageEndpoint = values.objectStorageEndpoint.trim();
            const nextObjectStoragePublicBaseUrl =
              values.objectStoragePublicBaseUrl.trim();
            const nextObjectStoragePathPrefix =
              values.objectStoragePathPrefix.trim();
            const nextObjectStorageAccessKeyId =
              values.objectStorageAccessKeyId.trim();
            const nextObjectStorageSecretAccessKey =
              values.objectStorageSecretAccessKey.trim();
            const nextObjectStorageIsPathStyle = values.objectStorageIsPathStyle;
            const nextObjectStorageEnabled = values.objectStorageEnabled;

            const currentStorageSignature = JSON.stringify({
              provider: currentObjectStorage?.provider ?? "cloudflare_r2_s3",
              bucket: currentObjectStorage?.bucket ?? "",
              region: currentObjectStorage?.region ?? "",
              endpoint: currentObjectStorage?.endpoint ?? "",
              public_base_url: currentObjectStorage?.public_base_url ?? "",
              path_prefix: currentObjectStorage?.path_prefix ?? "",
              access_key_id: currentObjectStorage?.access_key_id ?? "",
              is_path_style: currentObjectStorage?.is_path_style ?? false,
              is_enabled: currentObjectStorage?.is_enabled ?? false,
            });
            const nextStorageSignature = JSON.stringify({
              provider: nextObjectStorageProvider,
              bucket: nextObjectStorageBucket,
              region: nextObjectStorageRegion,
              endpoint: nextObjectStorageEndpoint,
              public_base_url: nextObjectStoragePublicBaseUrl,
              path_prefix: nextObjectStoragePathPrefix,
              access_key_id: nextObjectStorageAccessKeyId,
              is_path_style: nextObjectStorageIsPathStyle,
              is_enabled: nextObjectStorageEnabled,
            });

            if (
              nextStorageSignature !== currentStorageSignature ||
              nextObjectStorageSecretAccessKey.length > 0
            ) {
              await updateDesktopObjectStorageConfig({
                provider: nextObjectStorageProvider,
                bucket: nextObjectStorageBucket,
                region: nextObjectStorageRegion || null,
                endpoint: nextObjectStorageEndpoint,
                public_base_url: nextObjectStoragePublicBaseUrl || null,
                path_prefix: nextObjectStoragePathPrefix || null,
                access_key_id: nextObjectStorageAccessKeyId,
                secret_access_key:
                  nextObjectStorageSecretAccessKey || undefined,
                is_path_style: nextObjectStorageIsPathStyle,
                is_enabled: nextObjectStorageEnabled,
              });
              objectStorageChanged = true;
            }
          } catch (error) {
            console.warn(
              "[desktop-settings] update object storage settings failed",
              error,
            );
          }
        }
      }

      await mutateSecretary?.();
      if (canEditDesktop) {
        await mutateUserEmbeddingConfig?.();
      }
      toast.success(t("toast.saveSuccess"));
      if (desktopEmbeddingChanged) {
        setHasPendingRebuild(true);
        setRebuildSummary(null);
        setRebuildProgress(null);
        setIsRebuildPromptOpen(true);
        toast(t("toast.rebuildRecommended"));
      }
      if (scoutSettingsChanged) {
        if (isTauriRuntime) {
          import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("register_local_skills"))
            .catch((error) => {
              console.warn(
                "[desktop-settings] refresh local skills after scout update failed",
                error,
              );
            });
        }
        toast(t("toast.desktopScoutUpdated"));
      }
      if (objectStorageChanged) {
        toast(t("toast.desktopObjectStorageUpdated"));
      }
    } catch {
      toast.error(t("toast.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  const showRebuildBanner =
    canEditDesktop && (hasPendingRebuild || isRebuilding || rebuildSummary);

  return (
    <Form {...form}>
      <div className="flex flex-col gap-0 md:flex-row md:gap-8">
        <SettingsNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          isTauriRuntime={isTauriRuntime}
        />

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="min-w-0 flex-1 space-y-5"
        >
          {/* Models section */}
          {activeSection === "models" && (
            <div className="flex flex-col gap-5">
              <DesktopEmbeddingSettingsCard
                control={form.control}
                isTauriRuntime={isTauriRuntime}
                canEditDesktop={canEditDesktop}
                hasAvailableModels={hasAvailableEmbeddingModels}
                modelGroups={embeddingModelGroups}
                isLoadingModels={isLoadingEmbeddingModels}
              />
              <PersonalSettingsCard
                control={form.control}
                canEditPersonal={canEditPersonal}
                hasAvailableModels={hasAvailableChatModels}
                modelGroups={chatModelGroups}
                isLoadingModels={isLoadingChatModels}
              />

              {/* Rebuild banner */}
              {showRebuildBanner && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] px-5 py-4 dark:border-amber-400/15 dark:bg-amber-400/[0.06]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 dark:bg-amber-400/10">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {t("desktop.rebuildTitle")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("desktop.rebuildDescription")}
                      </p>

                      {isRebuilding && (
                        <div className="mt-3 space-y-1.5">
                          <Progress
                            value={rebuildProgress?.progress ?? 0}
                            className="h-1.5"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {t(
                              `desktop.rebuildStage.${rebuildProgress?.phase ?? "prepare"}`,
                            )}{" "}
                            · {rebuildProgress?.processed ?? 0}/
                            {rebuildProgress?.total ?? 0}
                          </p>
                        </div>
                      )}

                      {!isRebuilding && hasPendingRebuild && (
                        <div className="mt-3">
                          <GlassButton size="sm" onClick={handleStartRebuild}>
                            {t("desktop.rebuildAction")}
                          </GlassButton>
                        </div>
                      )}

                      {!isRebuilding && rebuildSummary && (
                        <div className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
                          <p>
                            {t("desktop.rebuildCompleted", {
                              memoryIndexed: rebuildSummary.memory_indexed,
                              memoryFailed: rebuildSummary.memory_failed,
                              assetIndexed: rebuildSummary.asset_indexed,
                              assetFailed: rebuildSummary.asset_failed,
                            })}
                          </p>
                          <p>
                            {t("desktop.rebuildMemorySummary", {
                              total: rebuildSummary.memory_total,
                              indexed: rebuildSummary.memory_indexed,
                              failed: rebuildSummary.memory_failed,
                            })}
                          </p>
                          <p>
                            {t("desktop.rebuildAssetSummary", {
                              total: rebuildSummary.asset_total,
                              indexed: rebuildSummary.asset_indexed,
                              failed: rebuildSummary.asset_failed,
                            })}
                          </p>
                          <p>
                            {t("desktop.rebuildVectorDimension", {
                              dimension: rebuildSummary.vector_dimension,
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Repair section */}
              {canEditDesktop && (
                <div className="rounded-2xl border border-border/40 bg-muted/15 px-5 py-4 dark:bg-muted/10">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/30 dark:bg-muted/20">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {t("desktop.repairTitle")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("desktop.repairDescription")}
                      </p>
                      <div className="mt-3">
                        <GlassButton
                          size="sm"
                          variant="secondary"
                          onClick={handleRepairIndexes}
                          loading={isRepairingIndexes}
                        >
                          {t("desktop.repairAction")}
                        </GlassButton>
                      </div>
                      {repairMessage ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {repairMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Agent section */}
          {activeSection === "agent" && (
            <div className="flex flex-col gap-5">
              <DeferredDesktopVersionManagementCard isTauriRuntime={isTauriRuntime} />
              <DeferredAgentSettingsCard isTauriRuntime={isTauriRuntime} />
              <DeferredDesktopSandboxSettingsCard isTauriRuntime={isTauriRuntime} />
            </div>
          )}

          {/* Browser section */}
          {activeSection === "browser" && isBrowserSectionVisible && (
            <div className="flex flex-col gap-5">
              <DeferredDesktopBrowserAgentPanelCard isTauriRuntime={isTauriRuntime} />
            </div>
          )}

          {/* Storage section */}
          {activeSection === "storage" && (
            <div className="flex flex-col gap-5">
              <DeferredDesktopObjectStorageSettingsCard
                control={form.control}
                isTauriRuntime={isTauriRuntime}
                canEditDesktop={canEditDesktop}
              />
            </div>
          )}

          {/* Relay section */}
          {activeSection === "relay" && (
            <div className="flex flex-col gap-5">
              <DeferredDesktopScoutSettingsCard
                control={form.control}
                isTauriRuntime={isTauriRuntime}
                canEditDesktop={canEditDesktop}
              />
            </div>
          )}

          {activeSection !== "agent" &&
            (activeSection !== "browser" || !isBrowserSectionVisible) && (
            <SettingsFormActions
              canSave={canSave}
              isSaving={isSaving}
              isSubmitting={form.formState.isSubmitting}
              onReset={() => form.reset()}
            />
            )}
        </form>
      </div>

      <AlertDialog
        open={isRebuildPromptOpen}
        onOpenChange={setIsRebuildPromptOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("desktop.rebuildTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("desktop.rebuildDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("desktop.rebuildLater")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartRebuild}>
              {t("desktop.rebuildAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
