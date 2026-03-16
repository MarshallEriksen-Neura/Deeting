import useSWR from "swr"

import type { AssistantTag } from "@/lib/api/assistants"
import { listLocalAssistantTags } from "@/lib/api/assistants"

export function useLocalAssistantTags(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<AssistantTag[], Error>(
    enabled ? "local-assistant-tags" : null,
    listLocalAssistantTags,
    { revalidateOnFocus: false }
  )

  return {
    tags: data ?? [],
    isLoading,
    error,
    mutate,
  }
}
