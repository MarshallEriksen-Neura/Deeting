import useSWR from "swr"
import type { NotificationChannelList } from "@/lib/api/notification-channels"
import { fetchNotificationChannels } from "@/lib/api/notification-channels"

/**
 * SWR hook for fetching user's notification channels
 */
export function useNotificationChannels() {
  const isTauriRuntime =
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  const { data, error, isLoading, mutate } = useSWR<NotificationChannelList>(
    isTauriRuntime ? "tauri://local-notification-channels" : "/api/v1/notification-channels",
    fetchNotificationChannels,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  )

  return { data, error, isLoading, mutate }
}
