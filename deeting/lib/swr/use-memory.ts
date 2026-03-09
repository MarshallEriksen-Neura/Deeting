import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import { fetchMemories, searchMemories } from "@/lib/api/memory"
import type { MemoryListResponse, MemoryItem } from "@/types/memory"

type MemorySearchFilters = {
  category?: string | null
  source?: string | null
  tags?: string[] | null
}

export function useMemorySearch(query: string, limit: number = 10, filters?: MemorySearchFilters) {
  const filterKey = JSON.stringify(filters ?? {})
  const { data, error, isValidating, mutate } = useSWR(
    query ? ["memory-search", query, limit, filterKey] : null,
    async () => {
      return searchMemories({
        query,
        limit,
        category: filters?.category ?? null,
        source: filters?.source ?? null,
        tags: filters?.tags ?? null,
      })
    },
    { revalidateOnFocus: false, dedupingInterval: 500 }
  )

  return {
    results: data ?? [],
    isLoading: !data && !error && !!query,
    isSearching: isValidating,
    error,
    mutate,
  }
}

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
    ([, limit, cursor]) => fetchMemories({ limit: limit as number, cursor: cursor as string | null }),
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
