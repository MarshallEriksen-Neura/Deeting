export type NotificationTimestamp = Date | string | number | null | undefined

export function normalizeNotificationTimestamp(value: NotificationTimestamp): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value
  }

  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  return new Date()
}
