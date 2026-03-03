import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { fetchAssistantTags, type AssistantTag } from "@/lib/api/assistants"

export function useAssistantTags() {
  const { data, error, isLoading, mutate } = useSWR<AssistantTag[], ApiError>(
    "assistant-tags",
    fetchAssistantTags,
    { revalidateOnFocus: false }
  )

  return {
    tags: data || [],
    isLoading,
    error,
    mutate,
  }
}
