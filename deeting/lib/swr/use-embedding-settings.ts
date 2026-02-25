import useSWR from "swr"

import { fetchUserSecretary, type UserSecretary } from "@/lib/api/secretary"

interface SWROptions {
  enabled?: boolean
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
