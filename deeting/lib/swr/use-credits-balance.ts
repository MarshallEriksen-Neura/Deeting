import useSWR from "swr"
import { fetchCreditsBalance } from "@/lib/api/credits"
import type { CreditsBalance } from "@/lib/api/credits"

export function useCreditsBalance() {
  const { data, error, isLoading, mutate } = useSWR<CreditsBalance>(
    "/api/v1/credits/balance",
    fetchCreditsBalance,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}
