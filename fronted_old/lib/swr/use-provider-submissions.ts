"use client";

import { useApiGet } from "./hooks";
import { useSWRConfig } from "swr";
import { providerSubmissionService, type ProviderSubmission } from "@/http/provider-submission";
import { swrKeys } from "./keys";

/**
 * 获取当前用户的提交列表（/providers/submissions/me）
 * 多处页面复用时，只改这里即可。
 */
export function useMyProviderSubmissions(enabled: boolean = true) {
  const { data, error, loading, refresh } = useApiGet<ProviderSubmission[]>(
    enabled ? swrKeys.providerSubmissionsMe() : null,
    { strategy: "frequent" }
  );

  return {
    submissions: data ?? [],
    loading,
    error,
    refresh,
  };
}

/**
 * 取消提交（写操作）
 * 统一缓存失效：我的提交列表
 */
export function useCancelProviderSubmission() {
  const { mutate } = useSWRConfig();

  return async (submissionId: string) => {
    await providerSubmissionService.cancelSubmission(submissionId);
    await mutate(swrKeys.providerSubmissionsMe());
  };
}
