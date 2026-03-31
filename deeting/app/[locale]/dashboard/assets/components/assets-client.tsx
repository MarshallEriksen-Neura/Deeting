"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Archive, ExternalLink, Loader2, Pin, PinOff, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  listLocalAssets,
  saveLocalAsset,
  updateLocalAsset,
  type LocalAsset,
} from "@/lib/api/local-assets"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AssetDetailSheet } from "./asset-detail-sheet"

interface CreateAssetFormState {
  assetId: string
  title: string
  summary: string
  renderHint: string
  dataMode: "ai_data" | "self_fetch"
  matchHints: string
  propsHint: string
  outputExample: string
  html: string
}

const INITIAL_CREATE_FORM: CreateAssetFormState = {
  assetId: "",
  title: "",
  summary: "",
  renderHint: "",
  dataMode: "ai_data",
  matchHints: "",
  propsHint: "",
  outputExample: "",
  html: "",
}

export function AssetsClient() {
  const t = useTranslations("dashboard.assetsPage")
  const [assets, setAssets] = useState<LocalAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<LocalAsset | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<CreateAssetFormState>(INITIAL_CREATE_FORM)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listLocalAssets({ limit: 100 })
      setAssets(data)
    } catch (error) {
      console.warn("load_local_assets_failed", error)
      toast.error(t("feedback.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const pinnedAssets = useMemo(
    () => assets.filter((asset) => asset.is_pinned && !asset.is_archived),
    [assets]
  )
  const recentAssets = useMemo(
    () => assets.filter((asset) => !asset.is_archived),
    [assets]
  )

  const mutateAsset = useCallback(
    async (
      assetId: string,
      request: { isPinned?: boolean; isArchived?: boolean; markOpened?: boolean }
    ) => {
      setBusyAssetId(assetId)
      try {
        const updated = await updateLocalAsset(assetId, request)
        setAssets((current) =>
          current.map((asset) => (asset.asset_id === updated.asset_id ? updated : asset))
        )
      } catch (error) {
        console.warn("update_local_asset_failed", error)
        toast.error(t("feedback.updateFailed"))
      } finally {
        setBusyAssetId(null)
      }
    },
    [t]
  )

  const openAssetDetail = useCallback(
    async (asset: LocalAsset) => {
      setSelectedAsset(asset)
      setDetailOpen(true)
      await mutateAsset(asset.asset_id, { markOpened: true })
    },
    [mutateAsset]
  )

  const handleCreateAsset = useCallback(async () => {
    const assetId = createForm.assetId.trim()
    const title = createForm.title.trim()
    const html = createForm.html.trim()
    if (!assetId || !title || !html) {
      toast.error(t("feedback.createMissingFields"))
      return
    }

    let outputExample: unknown = undefined
    if (createForm.outputExample.trim()) {
      try {
        outputExample = JSON.parse(createForm.outputExample)
      } catch {
        toast.error(t("feedback.invalidOutputExample"))
        return
      }
    }

    setCreating(true)
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
      })

      await loadAssets()
      setCreateForm(INITIAL_CREATE_FORM)
      setCreateOpen(false)
    } catch (error) {
      console.warn("save_local_asset_failed", error)
      toast.error(t("feedback.createFailed"))
    } finally {
      setCreating(false)
    }
  }, [createForm, loadAssets, t])

  const renderAssetCard = (asset: LocalAsset) => (
    <div
      key={asset.asset_id}
      className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => void openAssetDetail(asset)}
        >
          <div className="truncate text-sm font-semibold text-foreground">{asset.title}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {asset.summary || t("empty.summary")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>{asset.render_hint || asset.source_view_type}</span>
            <span>·</span>
            <span>{t("fields.updatedAt", { value: asset.updated_at })}</span>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={busyAssetId === asset.asset_id}
            onClick={(event) => {
              event.stopPropagation()
              void mutateAsset(asset.asset_id, { isPinned: !asset.is_pinned })
            }}
            aria-label={asset.is_pinned ? t("actions.unpin") : t("actions.pin")}
          >
            {asset.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={busyAssetId === asset.asset_id}
            onClick={(event) => {
              event.stopPropagation()
              void mutateAsset(asset.asset_id, { isArchived: true })
            }}
            aria-label={t("actions.archive")}
          >
            <Archive className="h-4 w-4" />
          </Button>
          <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8">
            <Link
              href={`/chat?session=${encodeURIComponent(asset.origin_session_id)}`}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#05050A]">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("actions.create")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void loadAssets()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("actions.reload")}
            </Button>
          </div>
        </div>

        <section className="space-y-3">
          <div className="text-sm font-semibold text-foreground">{t("sections.pinned")}</div>
          {pinnedAssets.length > 0 ? (
            <div className="grid gap-3">{pinnedAssets.map(renderAssetCard)}</div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              {t("empty.pinned")}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="text-sm font-semibold text-foreground">{t("sections.recent")}</div>
          {loading ? (
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              {t("feedback.loading")}
            </div>
          ) : recentAssets.length > 0 ? (
            <div className="grid gap-3">{recentAssets.map(renderAssetCard)}</div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              {t("empty.recent")}
            </div>
          )}
        </section>
      </div>
      <AssetDetailSheet
        asset={selectedAsset}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("createDialog.title")}</DialogTitle>
            <DialogDescription>{t("createDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="asset-id">{t("createDialog.fields.assetId")}</Label>
                <Input
                  id="asset-id"
                  value={createForm.assetId}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, assetId: event.target.value }))
                  }
                  placeholder="weather-ios18-card"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="asset-title">{t("createDialog.fields.title")}</Label>
                <Input
                  id="asset-title"
                  value={createForm.title}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Weather iOS18"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="asset-summary">{t("createDialog.fields.summary")}</Label>
              <Input
                id="asset-summary"
                value={createForm.summary}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, summary: event.target.value }))
                }
                placeholder={t("createDialog.placeholders.summary")}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="asset-render-hint">{t("createDialog.fields.renderHint")}</Label>
                <Input
                  id="asset-render-hint"
                  value={createForm.renderHint}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, renderHint: event.target.value }))
                  }
                  placeholder="weather-card"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("createDialog.fields.dataMode")}</Label>
                <Select
                  value={createForm.dataMode}
                  onValueChange={(value: "ai_data" | "self_fetch") =>
                    setCreateForm((current) => ({ ...current, dataMode: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ai_data">{t("createDialog.options.aiData")}</SelectItem>
                    <SelectItem value="self_fetch">
                      {t("createDialog.options.selfFetch")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="asset-match-hints">{t("createDialog.fields.matchHints")}</Label>
                <Input
                  id="asset-match-hints"
                  value={createForm.matchHints}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, matchHints: event.target.value }))
                  }
                  placeholder={t("createDialog.placeholders.matchHints")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="asset-props-hint">{t("createDialog.fields.propsHint")}</Label>
                <Input
                  id="asset-props-hint"
                  value={createForm.propsHint}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, propsHint: event.target.value }))
                  }
                  placeholder={t("createDialog.placeholders.propsHint")}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="asset-output-example">
                {t("createDialog.fields.outputExample")}
              </Label>
              <Textarea
                id="asset-output-example"
                value={createForm.outputExample}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    outputExample: event.target.value,
                  }))
                }
                className="min-h-28 font-mono"
                placeholder={t("createDialog.placeholders.outputExample")}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="asset-html">{t("createDialog.fields.html")}</Label>
              <Textarea
                id="asset-html"
                value={createForm.html}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, html: event.target.value }))
                }
                className="min-h-64 font-mono"
                placeholder={t("createDialog.placeholders.html")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("createDialog.actions.cancel")}
            </Button>
            <Button type="button" onClick={() => void handleCreateAsset()} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("createDialog.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function splitCommaSeparatedValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
