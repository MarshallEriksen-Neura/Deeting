import type { ModelGroup as ApiModelGroup } from "@/lib/api/models";

export interface SettingsFormValues {
  secretaryModel: string;
  desktopEmbeddingProviderModelId: string;
  scoutBaseUrl: string;
  objectStorageProvider: "cloudflare_r2_s3" | "aliyun_oss";
  objectStorageBucket: string;
  objectStorageRegion: string;
  objectStorageEndpoint: string;
  objectStoragePublicBaseUrl: string;
  objectStoragePathPrefix: string;
  objectStorageAccessKeyId: string;
  objectStorageSecretAccessKey: string;
  objectStorageIsPathStyle: boolean;
  objectStorageEnabled: boolean;
}

export type ModelGroup = ApiModelGroup;
