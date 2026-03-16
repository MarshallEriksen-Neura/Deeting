import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { fetchAssistantTags, type AssistantTag } from "@/lib/api/assistants"

export function useAssistantTags(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<AssistantTag[], ApiError>(
    enabled ? "assistant-tags" : null,
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
