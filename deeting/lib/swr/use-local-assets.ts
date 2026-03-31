import useSWR from "swr"

import { listLocalAssets, type LocalAsset } from "@/lib/api/local-assets"

const isTauriRuntime =
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export function useLocalAssets(options?: {
  limit?: number
  pinnedOnly?: boolean
  includeArchived?: boolean
}) {
  const key = isTauriRuntime
    ? [
        "tauri://local-assets",
        options?.limit ?? 50,
        options?.pinnedOnly ?? false,
        options?.includeArchived ?? false,
      ]
    : null

  const { data, error, isLoading, mutate } = useSWR<LocalAsset[]>(
    key,
    () =>
      listLocalAssets({
        limit: options?.limit ?? 50,
        pinnedOnly: options?.pinnedOnly ?? false,
        includeArchived: options?.includeArchived ?? false,
      }),
    {
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
    }
  )

  return { data, error, isLoading, mutate }
}
