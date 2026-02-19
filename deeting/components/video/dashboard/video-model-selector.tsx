"use client";

import { useMemo, useEffect } from "react";
import { Film, ChevronDown, Loader2 } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useChatService } from "@/hooks/use-chat-service";
import { useVideoGenerationStore } from "@/store/video-generation-store";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function VideoModelSelector() {
  const t = useI18n("video");
  const { selectedModelId, setSelectedModelId } = useVideoGenerationStore();

  const { models, modelGroups, isLoadingModels } = useChatService({
    enabled: true,
    modelCapability: "video_generation",
  });

  // Auto-select the first available model if none is selected
  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      const first = models[0];
      setSelectedModelId(first.provider_model_id ?? first.id);
    }
  }, [selectedModelId, models, setSelectedModelId]);

  const selectedModel = useMemo(
    () =>
      models.find(
        (m) =>
          m.provider_model_id === selectedModelId || m.id === selectedModelId
      ),
    [models, selectedModelId]
  );

  const displayName = selectedModel
    ? selectedModel.id
    : selectedModelId || t("modelPlaceholder");

  if (isLoadingModels) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t("modelLoading")}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {t("modelEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground/90 flex items-center gap-2">
        <Film className="w-4 h-4 text-cyan-400" />
        {t("model")}
      </label>
      <Select
        value={selectedModelId ?? ""}
        onValueChange={setSelectedModelId}
      >
        <SelectTrigger className="w-full bg-foreground/5 border-foreground/10 text-foreground text-xs hover:bg-foreground/10 focus:ring-cyan-400/30">
          <SelectValue placeholder={t("modelPlaceholder")}>
            <span className="truncate">{displayName}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {modelGroups.map((group) => (
            <SelectGroup key={group.instance_id}>
              <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {group.instance_name}
              </SelectLabel>
              {group.models.map((model) => {
                const value = model.provider_model_id ?? model.id;
                return (
                  <SelectItem key={value} value={value} className="text-xs">
                    {model.id}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
