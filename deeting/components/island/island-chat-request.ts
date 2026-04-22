"use client";

import type { ModelInfo } from "@/lib/api/models";
import {
  isDesktopLocalModel,
  matchesChatModelSelectionValue,
} from "@/lib/api/models";
import type { IslandChatRequestConfig } from "@/lib/api/island";

export function resolveIslandChatRequestConfig({
  configModel,
  models,
  isTauriRuntime,
}: {
  configModel?: string | null;
  models: ModelInfo[];
  isTauriRuntime: boolean;
}): IslandChatRequestConfig | null {
  const selectedModel =
    models.find((model) => matchesChatModelSelectionValue(model, configModel)) ??
    models[0] ??
    null;

  if (!selectedModel) {
    return null;
  }

  const useDesktopLocalGateway = isTauriRuntime;
  const isDesktopLocalSelection = isTauriRuntime && isDesktopLocalModel(selectedModel);
  const localProviderModelId = isDesktopLocalSelection
    ? selectedModel.provider_model_id?.trim() || undefined
    : undefined;

  return {
    model: selectedModel.id,
    model_selection_mode: isDesktopLocalSelection ? "pool" : undefined,
    provider_model_id: isDesktopLocalSelection
      ? localProviderModelId
      : selectedModel.provider_model_id ?? undefined,
    useDesktopLocalGateway,
  };
}
