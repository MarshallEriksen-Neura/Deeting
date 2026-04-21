"use client";

import { toast } from "sonner";
import type { NotificationItem } from "@/components/notifications/types";
import { useNotificationActions } from "@/store/notification-store";

type NotificationInput = Pick<
  NotificationItem,
  "type" | "title" | "description" | "timestamp" | "meta" | "action"
>;

export function useNotifications() {
  const { add } = useNotificationActions();

  const addNotification = (notification: NotificationInput) => {
    add(notification);

    const description = notification.description?.trim() || undefined;
    const action = notification.action
      ? {
          label: notification.action.label,
          onClick: notification.action.onClick,
        }
      : undefined;

    switch (notification.type) {
      case "success":
        toast.success(notification.title, { description, action });
        break;
      case "error":
        toast.error(notification.title, { description, action });
        break;
      case "warning":
        toast.warning(notification.title, { description, action });
        break;
      default:
        toast.info(notification.title, { description, action });
        break;
    }
  };

  return { addNotification };
}
