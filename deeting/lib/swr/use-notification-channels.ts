import useSWR from "swr"
import type { NotificationChannelList } from "@/lib/api/notification-channels"
import { fetchNotificationChannels } from "@/lib/api/notification-channels"

/**
 * SWR hook for fetching user's notification channels
 */
export function useNotificationChannels() {
  const { data, error, isLoading, mutate } = useSWR<NotificationChannelList>(
    "/api/v1/notification-channels",
    fetchNotificationChannels,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  )

  return { data, error, isLoading, mutate }
}
