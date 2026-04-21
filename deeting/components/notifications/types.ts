"use client";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: Date | string | number;
  read: boolean;
  meta?: {
    reason?: string;
  };
  action?: {
    label: string;
    onClick: () => void;
  };
}
