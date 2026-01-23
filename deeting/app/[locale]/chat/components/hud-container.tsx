"use client";

import { Clock, Sparkles } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { usePathname, useSelectedLayoutSegments } from "next/navigation";
import { ImageHistorySidebar } from "../components/image-history-sidebar";
import { HistorySidebar } from "../components/history-sidebar";
import { useChatStore } from "@/store/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useChatService } from "@/hooks/use-chat-service";
import { useI18n } from "@/hooks/use-i18n";
import { useImageGenerationStore } from "@/store/image-generation-store";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function HUD() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const t = useI18n("chat");
  const pathname = usePathname();
  const controlSegments = useSelectedLayoutSegments("controls");

  const isImage =
    (controlSegments?.[0] === "create" && controlSegments?.[1] === "image") ||
    Boolean(pathname?.includes("/create/image"));

  const chatModels = useChatStore((state) => state.models);
  const { config, setConfig, setAssistants, setModels } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setConfig: state.setConfig,
      setAssistants: state.setAssistants,
      setModels: state.setModels,
    }))
  );

  const {
    assistants: serviceAssistants,
    models: chatServiceModels,
    modelGroups: chatModelGroups,
    isLoadingModels: isLoadingChatModels,
  } = useChatService({
    enabled: !isImage,
  });
  const {
    modelGroups: imageModelGroups,
    isLoadingModels: isLoadingImageModels,
  } = useChatService({
    enabled: isImage,
    modelCapability: "image_generation",
  });

  if (serviceAssistants.length && !useChatStore.getState().assistants.length) {
    setAssistants(serviceAssistants);
  }
  if (chatServiceModels.length && !chatModels.length) {
    setModels(chatServiceModels);
  }

  const { selectedModelId, setSelectedModelId } = useImageGenerationStore();
  const activeModelGroups = isImage ? imageModelGroups : chatModelGroups;
  const isLoadingModels = isImage ? isLoadingImageModels : isLoadingChatModels;
  const selectedModelValue = isImage ? selectedModelId ?? "" : config.model ?? "";
  const handleModelChange = (modelId: string) => {
    if (isImage) {
      setSelectedModelId(modelId);
    } else {
      setConfig({ model: modelId });
    }
  };
  const modelLabel = isImage ? t("image.model") : t("model.label");
  const historyLabel = isImage ? t("imageHistory.title") : t("history.title");

  return (
    <>
      <motion.nav
        layout
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded-full",
          "bg-white/60 dark:bg-white/10",
          "backdrop-blur-2xl",
          "border border-white/30 dark:border-white/15",
          "shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)]",
          "relative z-50"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full",
            "hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
          )}
        >
          {isImage && <Sparkles className="w-4 h-4 text-primary" />}
          <Label className="text-xs text-muted-foreground">{modelLabel}</Label>
          <Select
            value={selectedModelValue}
            onValueChange={handleModelChange}
            disabled={isLoadingModels || activeModelGroups.length === 0}
          >
            <SelectTrigger className="h-7 w-[180px] border-0 bg-transparent text-xs shadow-none focus:ring-0">
              <SelectValue placeholder={t("model.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {activeModelGroups.map((group) => (
                <SelectGroup key={group.instance_id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.instance_name}
                  </SelectLabel>
                  {group.models.map((model) => {
                    const modelValue = model.provider_model_id ?? model.id;
                    return (
                      <SelectItem key={modelValue} value={modelValue}>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground">{model.id}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.provider || model.owned_by || "provider"}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-4 bg-white/30 dark:bg-white/15" />

        <button
          onClick={() => setIsHistoryOpen(true)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full",
            "text-xs font-medium text-muted-foreground",
            "hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{historyLabel}</span>
        </button>
      </motion.nav>

      {isImage ? (
        <ImageHistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
      ) : (
        <HistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
      )}
    </>
  );
}
