"use client";

import { useApiGet } from "@/lib/swr";
import type {
  ProviderPreset,
  ProviderPresetListResponse,
} from "@/http/provider-preset";

interface UseProviderPresetsResult {
  presets: ProviderPreset[];
  total: number;
  loading: boolean;
  validating: boolean;
  error: any;
  refresh: () => Promise<ProviderPresetListResponse | undefined>;
}

/**
 * 使用 SWR 获取提供商预设列表的通用 Hook。
 * - 统一使用 `/provider-presets` 作为 key，方便在多个组件间复用缓存
 * - 默认使用 `static` 缓存策略（数据相对稳定）
 */
export const useProviderPresets = (): UseProviderPresetsResult => {
  const {
    data,
    error,
    loading,
    validating,
    refresh,
  } = useApiGet<ProviderPresetListResponse>("/provider-presets", {
    // 预设列表变化频率较低，使用静态缓存策略
    strategy: "static",
  });

  return {
    presets: data?.items ?? [],
    total: data?.total ?? 0,
    loading,
    validating,
    error,
    refresh,
  };
};

