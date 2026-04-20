"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Container } from "@/ui/common/container";
import { Input } from "@/ui/shadcn/input";
import {
  listLocalAssets,
  saveLocalAsset,
  updateLocalAsset,
  type LocalAsset,
} from "@/lib/api/local-assets";
import { cn } from "@/lib/utils";

import { AssetDetailSheet } from "./asset-detail-sheet";
import { AssetLibraryCard } from "./asset-library-card";
import { AssetsCreateDialog } from "./assets-create-dialog";
import { AssetsHero } from "./assets-hero";
import {
  INITIAL_CREATE_FORM,
  matchesAssetFilter,
  matchesAssetQuery,
  sortAssetsByActivity,
  splitCommaSeparatedValues,
  type AssetFilter,
  type CreateAssetFormState,
} from "./assets-utils";

export function AssetsClient() {
  const t = useTranslations("dashboard.assetsPage");
  const locale = useLocale();

  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<LocalAsset | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<AssetFilter>("all");
  const [createForm, setCreateForm] =
    useState<CreateAssetFormState>(INITIAL_CREATE_FORM);

  const deferredSearchQuery = useDeferredValue(
    searchQuery.trim().toLowerCase(),
  );

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLocalAssets({ limit: 100 });
      setAssets(data);
    } catch (error) {
      console.warn("load_local_assets_failed", error);
      toast.error(t("feedback.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const activeAssets = useMemo(
    () => sortAssetsByActivity(assets.filter((asset) => !asset.is_archived)),
    [assets],
  );
  const pinnedAssets = useMemo(
    () => activeAssets.filter((asset) => asset.is_pinned),
    [activeAssets],
  );
  const selfFetchAssets = useMemo(
    () => activeAssets.filter((asset) => asset.data_mode === "self_fetch"),
    [activeAssets],
  );
  const previewReadyCount = useMemo(
    () =>
      activeAssets.filter((asset) => Boolean(asset.latest_snapshot_html))
        .length,
    [activeAssets],
  );
  const filteredAssets = useMemo(
    () =>
      activeAssets.filter(
        (asset) =>
          matchesAssetFilter(asset, activeFilter) &&
          matchesAssetQuery(asset, deferredSearchQuery),
      ),
    [activeAssets, activeFilter, deferredSearchQuery],
  );
  const filteredPinnedAssets = useMemo(
    () => filteredAssets.filter((asset) => asset.is_pinned),
    [filteredAssets],
  );
  const spotlightAsset =
    filteredPinnedAssets[0] ??
    filteredAssets[0] ??
    pinnedAssets[0] ??
    activeAssets[0] ??
    null;

  const hasFiltering = activeFilter !== "all" || deferredSearchQuery.length > 0;

  const mutateAsset = useCallback(
    async (
      assetId: string,
      request: {
        isPinned?: boolean;
        isArchived?: boolean;
        markOpened?: boolean;
      },
    ) => {
      setBusyAssetId(assetId);
      try {
        const updated = await updateLocalAsset(assetId, request);
        setAssets((current) =>
          current.map((asset) =>
            asset.asset_id === updated.asset_id ? updated : asset,
          ),
        );
        setSelectedAsset((current) =>
          current?.asset_id === updated.asset_id ? updated : current,
        );
      } catch (error) {
        console.warn("update_local_asset_failed", error);
        toast.error(t("feedback.updateFailed"));
      } finally {
        setBusyAssetId(null);
      }
    },
    [t],
  );

  const openAssetDetail = useCallback(
    async (asset: LocalAsset) => {
      setSelectedAsset(asset);
      setDetailOpen(true);
      await mutateAsset(asset.asset_id, { markOpened: true });
    },
    [mutateAsset],
  );

  const handleCreateAsset = useCallback(async () => {
    const assetId = createForm.assetId.trim();
    const title = createForm.title.trim();
    const html = createForm.html.trim();

    if (!assetId || !title || !html) {
      toast.error(t("feedback.createMissingFields"));
      return;
    }

    let outputExample: unknown = undefined;
    if (createForm.outputExample.trim()) {
      try {
        outputExample = JSON.parse(createForm.outputExample);
      } catch {
        toast.error(t("feedback.invalidOutputExample"));
        return;
      }
    }

    setCreating(true);
    try {
      await saveLocalAsset({
        assetId,
        title,
        html,
        summary: createForm.summary.trim() || undefined,
        renderHint: createForm.renderHint.trim() || undefined,
        dataMode: createForm.dataMode,
        matchHints: splitCommaSeparatedValues(createForm.matchHints),
        propsHint: splitCommaSeparatedValues(createForm.propsHint),
        outputExample,
      });

      await loadAssets();
      setCreateForm(INITIAL_CREATE_FORM);
      setCreateOpen(false);
    } catch (error) {
      console.warn("save_local_asset_failed", error);
      toast.error(t("feedback.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [createForm, loadAssets, t]);

  const filterOptions: Array<{ value: AssetFilter; label: string }> = [
    { value: "all", label: t("filters.all") },
    { value: "pinned", label: t("filters.pinned") },
    { value: "ai_data", label: t("filters.aiData") },
    { value: "self_fetch", label: t("filters.selfFetch") },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[linear-gradient(180deg,#f7fbff_0%,#f2f7ff_32%,#fbfcfe_100%)] dark:bg-[linear-gradient(180deg,#08111c_0%,#091521_40%,#0b1220_100%)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[420px] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_24%)] dark:block" />
      <Container
        as="main"
        size="full"
        gutter="md"
        className="relative py-6 md:py-8"
      >
        <div className="flex flex-col gap-6">
          <AssetsHero
            activeAssetCount={activeAssets.length}
            loading={loading}
            onCreate={() => setCreateOpen(true)}
            onOpenSpotlight={() =>
              spotlightAsset && void openAssetDetail(spotlightAsset)
            }
            onReload={() => void loadAssets()}
            pinnedAssetCount={pinnedAssets.length}
            previewReadyCount={previewReadyCount}
            selfFetchAssetCount={selfFetchAssets.length}
            spotlightAsset={spotlightAsset}
            t={t}
          />

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex items-center gap-3 rounded-[24px] border border-slate-200/70 bg-white/80 px-4 py-3 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-white/[0.05]">
              <Search className="size-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("search.placeholder")}
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
              {searchQuery ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => setSearchQuery("")}
                >
                  {t("actions.clearSearch")}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {filterOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={
                    activeFilter === option.value ? "default" : "secondary"
                  }
                  className={cn(
                    "rounded-full px-4",
                    activeFilter === option.value
                      ? "bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                      : "bg-white/80 text-slate-700 hover:bg-white dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]",
                  )}
                  onClick={() => setActiveFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </section>

          <AssetSection
            count={filteredPinnedAssets.length}
            description={t("descriptions.pinned")}
            emptyMessage={
              hasFiltering ? t("empty.filtered") : t("empty.pinned")
            }
            locale={locale}
            title={t("sections.pinned")}
            assets={filteredPinnedAssets}
            busyAssetId={busyAssetId}
            onArchive={(asset) =>
              void mutateAsset(asset.asset_id, { isArchived: true })
            }
            onOpenDetails={(asset) => void openAssetDetail(asset)}
            onTogglePin={(asset) =>
              void mutateAsset(asset.asset_id, { isPinned: !asset.is_pinned })
            }
            t={t}
          />

          <AssetSection
            count={filteredAssets.length}
            description={t("descriptions.library")}
            emptyMessage={
              hasFiltering ? t("empty.filtered") : t("empty.recent")
            }
            locale={locale}
            title={t("sections.library")}
            assets={loading ? [] : filteredAssets}
            busyAssetId={busyAssetId}
            loading={loading}
            onArchive={(asset) =>
              void mutateAsset(asset.asset_id, { isArchived: true })
            }
            onOpenDetails={(asset) => void openAssetDetail(asset)}
            onTogglePin={(asset) =>
              void mutateAsset(asset.asset_id, { isPinned: !asset.is_pinned })
            }
            t={t}
          />
        </div>
      </Container>

      <AssetDetailSheet
        asset={selectedAsset}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <AssetsCreateDialog
        creating={creating}
        form={createForm}
        htmlPlaceholder={t.raw("createDialog.placeholders.html") as string}
        onFieldChange={(patch) =>
          setCreateForm((current) => ({
            ...current,
            ...patch,
          }))
        }
        onOpenChange={setCreateOpen}
        onSubmit={() => void handleCreateAsset()}
        open={createOpen}
        outputExamplePlaceholder={
          t.raw("createDialog.placeholders.outputExample") as string
        }
        t={t}
      />
    </div>
  );
}

function AssetSection({
  assets,
  busyAssetId,
  count,
  description,
  emptyMessage,
  loading = false,
  locale,
  onArchive,
  onOpenDetails,
  onTogglePin,
  t,
  title,
}: {
  assets: LocalAsset[];
  busyAssetId: string | null;
  count: number;
  description: string;
  emptyMessage: string;
  loading?: boolean;
  locale: string;
  onArchive: (asset: LocalAsset) => void;
  onOpenDetails: (asset: LocalAsset) => void;
  onTogglePin: (asset: LocalAsset) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  title: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
            {title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {description}
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-slate-200 bg-white/80 px-3 py-1 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
        >
          {count}
        </Badge>
      </div>

      {loading ? (
        <EmptyStateCard>{t("feedback.loading")}</EmptyStateCard>
      ) : assets.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {assets.map((asset) => (
            <AssetLibraryCard
              key={asset.asset_id}
              asset={asset}
              busyAssetId={busyAssetId}
              locale={locale}
              onArchive={() => onArchive(asset)}
              onOpenConversation={
                asset.origin_session_id
                  ? `/chat?session=${encodeURIComponent(asset.origin_session_id)}`
                  : null
              }
              onOpenDetails={() => onOpenDetails(asset)}
              onTogglePin={() => onTogglePin(asset)}
              t={t}
            />
          ))}
        </div>
      ) : (
        <EmptyStateCard>{emptyMessage}</EmptyStateCard>
      )}
    </section>
  );
}

function EmptyStateCard({ children }: { children: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300/80 bg-white/70 p-8 text-sm text-slate-500 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
      {children}
    </div>
  );
}
