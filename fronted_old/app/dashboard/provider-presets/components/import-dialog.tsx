"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CreateProviderPresetRequest,
  providerPresetService,
} from "@/http/provider-preset";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n-context";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: ImportDialogProps) {
  const { t } = useI18n();
  const [importing, setImporting] = useState(false);
  const [parsedPresets, setParsedPresets] = useState<
    CreateProviderPresetRequest[]
  >([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const resetImportState = () => {
    setParsedPresets([]);
    setImportError(null);
    setImportFileName("");
    setOverwriteExisting(false);
    setFileInputKey((key) => key + 1);
  };

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      resetImportState();
    }
    onOpenChange(open);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);

    // 检查文件大小（限制为 10MB）
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setImportError(t("provider_presets.import_file_size_error"));
      setParsedPresets([]);
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const presetsData = Array.isArray(parsed) ? parsed : parsed?.presets;

      if (!Array.isArray(presetsData)) {
        setImportError(t("provider_presets.import_format_error"));
        setParsedPresets([]);
        return;
      }

      if (presetsData.length === 0) {
        setImportError(t("provider_presets.import_empty_error"));
        setParsedPresets([]);
        return;
      }

      setParsedPresets(presetsData as CreateProviderPresetRequest[]);
      setImportError(null);
    } catch (err) {
      console.error("导入文件解析失败:", err);
      setImportError(t("provider_presets.import_parse_error"));
      setParsedPresets([]);
    }
  };

  const handleSubmit = async () => {
    if (parsedPresets.length === 0) {
      setImportError(t("provider_presets.import_no_file_error"));
      return;
    }

    setImporting(true);
    try {
      const result = await providerPresetService.importProviderPresets({
        presets: parsedPresets,
        overwrite: overwriteExisting,
      });

      const summaryParts = [
        t("provider_presets.import_summary_created", { count: result.created.length }),
        t("provider_presets.import_summary_updated", { count: result.updated.length }),
      ];
      if (result.skipped.length > 0) {
        summaryParts.push(t("provider_presets.import_summary_skipped", { count: result.skipped.length }));
      }

      toast.success(t("provider_presets.import_success", { summary: summaryParts.join(" / ") }));
      if (result.failed.length > 0) {
        toast.error(t("provider_presets.import_failed", { count: result.failed.length }));
      }

      resetImportState();
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error("导入预设失败:", error);
      const message =
        error.response?.data?.detail || error.message || t("provider_presets.import_error");
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("provider_presets.import_title")}</DialogTitle>
          <DialogDescription>
            {t("provider_presets.import_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-file">{t("provider_presets.import_file_label")}</Label>
            <Input
              key={fileInputKey}
              id="import-file"
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
            />
            {importFileName && (
              <p className="text-sm text-muted-foreground">
                {t("provider_presets.import_file_selected", { filename: importFileName })}
              </p>
            )}
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="overwrite-existing"
              checked={overwriteExisting}
              onCheckedChange={(checked) =>
                setOverwriteExisting(Boolean(checked))
              }
            />
            <div className="space-y-1">
              <Label htmlFor="overwrite-existing" className="cursor-pointer">
                {t("provider_presets.import_overwrite_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("provider_presets.import_overwrite_hint")}
              </p>
            </div>
          </div>

          {parsedPresets.length > 0 && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p>{t("provider_presets.import_preview", { count: parsedPresets.length })}</p>
              <p className="text-muted-foreground">
                {t("provider_presets.import_preview_ids", {
                  ids: parsedPresets
                    .slice(0, 3)
                    .map((p) => p.preset_id)
                    .filter(Boolean)
                    .join(", ") + (parsedPresets.length > 3 ? " ..." : "")
                })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetImportState();
            }}
            disabled={importing}
          >
            {t("provider_presets.import_cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={importing || parsedPresets.length === 0}
          >
            {importing ? t("provider_presets.importing") : t("provider_presets.import_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
