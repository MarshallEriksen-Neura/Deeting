"use client";

import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { AssetPageTranslator, CreateAssetFormState } from "./assets-utils";

interface AssetsCreateDialogProps {
  creating: boolean;
  form: CreateAssetFormState;
  htmlPlaceholder: string;
  onFieldChange: (patch: Partial<CreateAssetFormState>) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  open: boolean;
  outputExamplePlaceholder: string;
  t: AssetPageTranslator;
}

export function AssetsCreateDialog({
  creating,
  form,
  htmlPlaceholder,
  onFieldChange,
  onOpenChange,
  onSubmit,
  open,
  outputExamplePlaceholder,
  t,
}: AssetsCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-[28px] border-slate-200 bg-white/95 p-0 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.4)] dark:border-white/10 dark:bg-[#08111b]/95">
        <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl text-slate-950 dark:text-white">
              {t("createDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              {t("createDialog.description")}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="asset-id">
                {t("createDialog.fields.assetId")}
              </Label>
              <Input
                id="asset-id"
                value={form.assetId}
                onChange={(event) =>
                  onFieldChange({ assetId: event.target.value })
                }
                placeholder="weather-ios18-card"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="asset-title">
                {t("createDialog.fields.title")}
              </Label>
              <Input
                id="asset-title"
                value={form.title}
                onChange={(event) =>
                  onFieldChange({ title: event.target.value })
                }
                placeholder="Weather iOS18"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="asset-summary">
              {t("createDialog.fields.summary")}
            </Label>
            <Input
              id="asset-summary"
              value={form.summary}
              onChange={(event) =>
                onFieldChange({ summary: event.target.value })
              }
              placeholder={t("createDialog.placeholders.summary")}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="asset-render-hint">
                {t("createDialog.fields.renderHint")}
              </Label>
              <Input
                id="asset-render-hint"
                value={form.renderHint}
                onChange={(event) =>
                  onFieldChange({ renderHint: event.target.value })
                }
                placeholder="weather-card"
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("createDialog.fields.dataMode")}</Label>
              <Select
                value={form.dataMode}
                onValueChange={(value: "ai_data" | "self_fetch") =>
                  onFieldChange({ dataMode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai_data">
                    {t("createDialog.options.aiData")}
                  </SelectItem>
                  <SelectItem value="self_fetch">
                    {t("createDialog.options.selfFetch")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="asset-match-hints">
                {t("createDialog.fields.matchHints")}
              </Label>
              <Input
                id="asset-match-hints"
                value={form.matchHints}
                onChange={(event) =>
                  onFieldChange({ matchHints: event.target.value })
                }
                placeholder={t("createDialog.placeholders.matchHints")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="asset-props-hint">
                {t("createDialog.fields.propsHint")}
              </Label>
              <Input
                id="asset-props-hint"
                value={form.propsHint}
                onChange={(event) =>
                  onFieldChange({ propsHint: event.target.value })
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
              value={form.outputExample}
              onChange={(event) =>
                onFieldChange({ outputExample: event.target.value })
              }
              className="min-h-28 font-mono"
              placeholder={outputExamplePlaceholder}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="asset-html">{t("createDialog.fields.html")}</Label>
            <Textarea
              id="asset-html"
              value={form.html}
              onChange={(event) => onFieldChange({ html: event.target.value })}
              className="min-h-72 font-mono"
              placeholder={htmlPlaceholder}
            />
          </div>
        </div>

        <div className="border-t border-slate-200/80 px-6 py-4 dark:border-white/10">
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              {t("createDialog.actions.cancel")}
            </Button>
            <Button type="button" onClick={onSubmit} disabled={creating}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("createDialog.actions.save")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
