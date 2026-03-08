import useSWR from "swr"
import { fetchCreditsRechargeOrders } from "@/lib/api/credits"
import type { CreditsRechargeOrders } from "@/lib/api/credits"

export function useCreditsRechargeOrders(params?: {
  limit?: number
  offset?: number
  status?: "pending" | "success" | "failed" | null
  startDate?: string | null
  endDate?: string | null
  query?: string | null
  sortBy?: "time" | "amount"
  sortDirection?: "asc" | "desc"
}) {
  const limit = params?.limit ?? 10
  const offset = params?.offset ?? 0
  const status = params?.status ?? null
  const startDate = params?.startDate ?? null
  const endDate = params?.endDate ?? null
  const query = params?.query ?? null
  const sortBy = params?.sortBy ?? "time"
  const sortDirection = params?.sortDirection ?? "desc"

  const { data, error, isLoading, mutate } = useSWR<CreditsRechargeOrders>(
    ["/api/v1/credits/recharge/orders", limit, offset, status, startDate, endDate, query, sortBy, sortDirection],
    () => fetchCreditsRechargeOrders({ limit, offset, status, startDate, endDate, query, sortBy, sortDirection }),
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

