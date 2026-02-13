import useSWR from "swr"
import {
  fetchKnowledgeTree,
  fetchKnowledgeStats,
  fetchFileChunks,
  type KnowledgeTreeResult,
} from "@/lib/api/knowledge"
import type {
  KnowledgeStats,
  KnowledgeChunk,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

export function useKnowledgeTree(params: {
  parentId: string | null
  q?: string
  sortField?: KnowledgeSortField
  sortDirection?: SortDirection
}) {
  const key = JSON.stringify([
    "knowledge-tree",
    params.parentId,
    params.q || "",
    params.sortField,
    params.sortDirection,
  ])

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<KnowledgeTreeResult>(key, () => fetchKnowledgeTree(params), {
      revalidateOnFocus: true,
      dedupingInterval: 2000,
      keepPreviousData: true,
    })

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
    files: data?.files ?? [],
    folders: data?.folders ?? [],
    breadcrumb: data?.breadcrumb ?? [],
  }
}

export function useKnowledgeStats() {
  const { data, error, isLoading, mutate } = useSWR<KnowledgeStats>(
    "knowledge-stats",
    fetchKnowledgeStats,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return { data, error, isLoading, mutate }
}

export function useFileChunks(
  fileId: string | null,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!fileId
  const key = enabled ? `knowledge-chunks-${fileId}` : null

  const { data, error, isLoading } = useSWR<{
    items: KnowledgeChunk[]
    total: number
  }>(key, () => fetchFileChunks(fileId!, { limit: 50 }), {
    revalidateOnFocus: false,
  })

  return {
    chunks: data?.items ?? [],
    total: data?.total ?? 0,
    error,
    isLoading,
  }
}
