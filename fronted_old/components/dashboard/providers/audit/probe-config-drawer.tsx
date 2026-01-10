"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Loader2 } from "lucide-react";
import type { Model } from "@/http/provider";

interface ProbeConfigDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  probeEnabled: boolean | null;
  setProbeEnabled: (enabled: boolean) => void;
  probeInterval: string;
  setProbeInterval: (interval: string) => void;
  probeModel: string;
  setProbeModel: (model: string) => void;
  models: Model[];
  savingProbe: boolean;
  onSave: () => Promise<void>;
  translations: {
    probeTitle: string;
    probeDesc: string;
    probeToggle: string;
    probeInterval: string;
    probeIntervalPlaceholder: string;
    probeIntervalHint: string;
    probeModel: string;
    probeModelPlaceholder: string;
    probeModelHint: string;
    probeSave: string;
    probeSaving: string;
    cancel: string;
  };
}

export const ProbeConfigDrawer = ({
  open,
  onOpenChange,
  probeEnabled,
  setProbeEnabled,
  probeInterval,
  setProbeInterval,
  probeModel,
  setProbeModel,
  models,
  savingProbe,
  onSave,
  translations,
}: ProbeConfigDrawerProps) => {
  const handleSave = async () => {
    await onSave();
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{translations.probeTitle}</DrawerTitle>
          <DrawerDescription>{translations.probeDesc}</DrawerDescription>
        </DrawerHeader>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div />
            <div className="flex items-center gap-2">
              <Switch
                checked={probeEnabled ?? false}
                onCheckedChange={(checked) => setProbeEnabled(checked)}
              />
              <span className="text-sm text-muted-foreground">{translations.probeToggle}</span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{translations.probeInterval}</Label>
              <Input
                type="number"
                min={60}
                placeholder={translations.probeIntervalPlaceholder}
                value={probeInterval}
                onChange={(e) => setProbeInterval(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{translations.probeIntervalHint}</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{translations.probeModel}</Label>
              <Select value={probeModel || ""} onValueChange={(val) => setProbeModel(val === "__none" ? "" : val)}>
                <SelectTrigger>
                  <SelectValue placeholder={translations.probeModelPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{translations.probeModelPlaceholder}</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      {model.display_name || model.model_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{translations.probeModelHint}</p>
            </div>
          </div>
        </div>
        <DrawerFooter>
          <div className="flex justify-end w-full gap-2">
            <DrawerClose>
              <Button variant="outline" size="sm">{translations.cancel}</Button>
            </DrawerClose>
            <Button size="sm" onClick={handleSave} disabled={savingProbe}>
              {savingProbe ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {translations.probeSaving}
                </>
              ) : (
                translations.probeSave
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};