"use client";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

interface ModelAliasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  modelId: string;
  alias: string;
  onAliasChange: (value: string) => void;
  onSave: () => void;
  loading: boolean;
}

export function ModelAliasDialog({
  open,
  onOpenChange,
  providerId,
  modelId,
  alias,
  onAliasChange,
  onSave,
  loading,
}: ModelAliasDialogProps) {
  const { t } = useI18n();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full max-w-md">
        <DrawerHeader>
          <DrawerTitle>{t("providers.alias_edit_title")}</DrawerTitle>
          <DrawerDescription className="font-mono text-xs break-all">
            {providerId} · {modelId}
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-alias" className="text-xs font-medium">
              {t("providers.alias_edit_label")}
            </Label>
            <Input
              id="model-alias"
              type="text"
              value={alias}
              onChange={(e) => onAliasChange(e.target.value)}
              placeholder={t("providers.alias_placeholder")}
              className="h-9"
            />
          </div>

          <p className="text-xs text-muted-foreground">{t("providers.alias_hint")}</p>
        </div>

        <DrawerFooter className="border-t bg-background/80 backdrop-blur">
          <div className="flex w-full justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onSave} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
