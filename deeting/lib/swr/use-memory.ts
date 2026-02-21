import useSWRInfinite from "swr/infinite"
import { fetchMemories } from "@/lib/api/memory"
import type { MemoryListResponse, MemoryItem } from "@/types/memory"

export function useMemories(pageSize: number = 20) {
  const getKey = (pageIndex: number, previousPageData: MemoryListResponse | null) => {
    // Reached the end
    if (previousPageData && !previousPageData.next_cursor) return null

    // First page, no cursor
    if (pageIndex === 0) return [`/api/v1/memory`, pageSize, null]

    // Use previous page's cursor
    return [`/api/v1/memory`, pageSize, previousPageData?.next_cursor]
  }

  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<MemoryListResponse>(
    getKey,
    ([url, limit, cursor]) => fetchMemories({ limit: limit as number, cursor: cursor as string | null }),
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
