import useSWR from "swr"

import { listLocalAssistants, type LocalAssistant } from "@/lib/api/assistants"

export function useLocalAssistants(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<LocalAssistant[], Error>(
    enabled ? "local-assistants" : null,
    listLocalAssistants,
    { revalidateOnFocus: false }
  )

  return {
    items: data ?? [],
    isLoading,
    error,
    mutate,
  }
}
