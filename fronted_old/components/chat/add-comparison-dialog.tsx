"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n-context";

export function AddComparisonDialog({
  open,
  onOpenChange,
  availableModels,
  selectedModel,
  onSelectedModelChange,
  onConfirm,
  isBusy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableModels: string[];
  selectedModel: string | null;
  onSelectedModelChange: (value: string) => void;
  onConfirm: () => void;
  isBusy: boolean;
}) {
  const { t } = useI18n();

  const selectItems = useMemo(() => {
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [availableModels]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("chat.message.add_comparison_title")}</DialogTitle>
          <DialogDescription>
            {t("chat.message.add_comparison_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="comparison-model">
            {t("chat.message.add_comparison_model_label")}
          </Label>
          <Select
            value={selectedModel ?? ""}
            onValueChange={onSelectedModelChange}
            disabled={isBusy}
          >
            <SelectTrigger id="comparison-model">
              <SelectValue
                placeholder={t("chat.message.add_comparison_model_placeholder")}
              />
            </SelectTrigger>
            <SelectContent>
              {selectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            {t("chat.action.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isBusy || !selectedModel}
          >
            {isBusy
              ? t("chat.message.add_comparison_running")
              : t("chat.message.add_comparison_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

