import useSWRInfinite from "swr/infinite"
import { fetchAdminSystemMemories } from "@/lib/api/admin-memory"
import type { MemoryListResponse, MemoryItem } from "@/types/memory"

export function useAdminSystemMemories(pageSize: number = 20) {
  const getKey = (pageIndex: number, previousPageData: MemoryListResponse | null) => {
    if (previousPageData && !previousPageData.next_cursor) return null
    if (pageIndex === 0) return [`/api/v1/admin/memory`, pageSize, null]
    return [`/api/v1/admin/memory`, pageSize, previousPageData?.next_cursor]
  }

  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<MemoryListResponse>(
    getKey,
    ([url, limit, cursor]) => fetchAdminSystemMemories({ limit: limit as number, cursor: cursor as string | null }),
    { revalidateFirstPage: false }
  )

  const memories: MemoryItem[] = data ? data.flatMap((page) => page.items) : []
  const isLoading = (!data && !error) || (size > 0 && data && typeof data[size - 1] === "undefined")
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] !== "undefined" && isValidating)
  const isReachedEnd = data && !data[data.length - 1]?.next_cursor

  return {
    memories,
    isLoading,
    isLoadingMore,
    isReachedEnd,
    error,
    mutate,
    loadMore: () => setSize(size + 1),
  }
}
