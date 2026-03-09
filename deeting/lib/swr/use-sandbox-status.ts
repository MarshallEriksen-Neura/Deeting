import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import type { SWRResult } from "@/lib/swr/fetcher"
import {
  getLocalSandboxInstallGuide,
  getLocalSandboxStatus,
  type SandboxInstallGuide,
  type SandboxReadinessReport,
} from "@/lib/api/sandbox"

type SandboxStatusState = {
  data: SandboxReadinessReport | undefined
  isLoading: boolean
  error?: ApiError
  mutate: SWRResult<SandboxReadinessReport>["mutate"]
}

type SandboxInstallGuideState = {
  data: SandboxInstallGuide | undefined
  isLoading: boolean
  error?: ApiError
  mutate: SWRResult<SandboxInstallGuide>["mutate"]
}

export function useSandboxStatus(
  options: { enabled?: boolean } = {}
): SandboxStatusState {
  const key = options.enabled === false ? null : "local-sandbox-status"
  const { data, error, isLoading, mutate } = useSWR<SandboxReadinessReport, ApiError>(
    key,
    async () => getLocalSandboxStatus(),
    {
      revalidateOnFocus: false,
    }
  )

  return { data, isLoading, error, mutate }
}

export function useSandboxInstallGuide(
  enabled = true
): SandboxInstallGuideState {
  const key = enabled ? "local-sandbox-install-guide" : null
  const { data, error, isLoading, mutate } = useSWR<SandboxInstallGuide, ApiError>(
    key,
    async () => getLocalSandboxInstallGuide(),
    {
      revalidateOnFocus: false,
    }
  )

  return { data, isLoading, error, mutate }
}
