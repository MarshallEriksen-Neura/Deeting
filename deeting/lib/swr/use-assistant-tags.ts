import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import type { AssistantTag } from "@/lib/api/assistants"

export function useAssistantTags() {
  const { data, error, isLoading, mutate } = useSWR<AssistantTag[], ApiError>(
    "/api/v1/assistants/tags",
    swrFetcher,
    { revalidateOnFocus: false }
  )

  return {
    tags: data || [],
    isLoading,
    error,
    mutate,
  }
}
