import type { ModelGroup as ApiModelGroup } from "@/lib/api/models";

export interface SettingsFormValues {
  secretaryModel: string;
  desktopEmbeddingProviderModelId: string;
  relayBaseUrl: string;
  relaySharedSecret: string;
  scoutBaseUrl: string;
}

export type ModelGroup = ApiModelGroup;
