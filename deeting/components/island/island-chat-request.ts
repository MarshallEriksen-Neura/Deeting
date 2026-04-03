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

  const useDesktopLocalGateway =
    isTauriRuntime && (selectedModel.request_route ?? "local_invoke") === "local_invoke";

  return {
    model: selectedModel.id,
    model_selection_mode:
      useDesktopLocalGateway && isDesktopLocalModel(selectedModel) ? "pool" : undefined,
    provider_model_id:
      useDesktopLocalGateway && isDesktopLocalModel(selectedModel)
        ? undefined
        : selectedModel.provider_model_id ?? undefined,
    useDesktopLocalGateway,
  };
}
