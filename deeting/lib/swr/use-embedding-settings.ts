import useSWR from "swr"

import { fetchEmbeddingSetting, type EmbeddingSetting } from "@/lib/api/settings"
import { fetchUserSecretary, type UserSecretary } from "@/lib/api/secretary"

interface SWROptions {
  enabled?: boolean
}

export function useSystemEmbeddingSetting(options?: SWROptions) {
  const key = options?.enabled === false ? null : "/api/v1/settings/embedding"
  const { data, error, isLoading, mutate } = useSWR<EmbeddingSetting>(
    key,
    fetchEmbeddingSetting,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return { data, error, isLoading, mutate }
}

export function useUserSecretary(options?: SWROptions) {
  const key = options?.enabled === false ? null : "/api/v1/users/me/secretary"
  const { data, error, isLoading, mutate } = useSWR<UserSecretary>(
    key,
    fetchUserSecretary,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return { data, error, isLoading, mutate }
}
