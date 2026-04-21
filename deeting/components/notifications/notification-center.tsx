"use client";

import { useMemo } from "react";
import { format, type Locale } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/shadcn/button";
import { Badge } from "@/components/ui/shadcn/badge";
import { ScrollArea } from "@/components/ui/shadcn/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { IconButton } from "@/components/ui/common/icon-button";
import { cn } from "@/lib/utils";
import {
  useNotificationActions,
  useNotificationsList,
  useNotificationSheet,
  useUnreadCount,
} from "@/store/notification-store";
import { normalizeNotificationTimestamp } from "@/components/notifications/notification-utils";
import type { NotificationItem } from "@/components/notifications/types";

const iconMap = {
  success: <CheckCircle2 className="size-4 text-emerald-600" />,
  error: <XCircle className="size-4 text-rose-600" />,
  warning: <AlertTriangle className="size-4 text-amber-600" />,
  info: <Info className="size-4 text-blue-600" />,
} as const;

const iconBgMap = {
  success: "bg-emerald-50 border-emerald-200",
  error: "bg-rose-50 border-rose-200",
  warning: "bg-amber-50 border-amber-200",
  info: "bg-blue-50 border-blue-200",
} as const;

const badgeColorMap = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200/50",
  error: "bg-rose-50 text-rose-700 border-rose-200/50",
  warning: "bg-amber-50 text-amber-700 border-amber-200/50",
  info: "bg-blue-50 text-blue-700 border-blue-200/50",
} as const;

function NotificationTimelineGroup({
  title,
  items,
  dateLocale,
}: {
  title: string;
  items: NotificationItem[];
  dateLocale: Locale;
}) {
  const t = useTranslations("notifications");
  const { markAsRead } = useNotificationActions();

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2">
        {items.map((notification) => (
          <article
            key={notification.id}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              notification.read
                ? "border-border/60 bg-background/70"
                : "border-border bg-background"
            )}
            onClick={() => {
              if (!notification.read) {
                markAsRead(notification.id);
              }
              notification.action?.onClick();
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border",
                  iconBgMap[notification.type]
                )}
              >
                {iconMap[notification.type]}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-medium text-foreground">
                      {notification.title}
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {notification.description}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={cn("shrink-0 text-[11px]", badgeColorMap[notification.type])}
                  >
                    {t(`types.${notification.type}`)}
                  </Badge>
                </div>

                {notification.meta?.reason ? (
                  <p className="mt-2 text-xs text-rose-600">
                    {t("reason")}: {notification.meta.reason}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <time className="text-[11px] tabular-nums text-muted-foreground">
                    {format(normalizeNotificationTimestamp(notification.timestamp), "HH:mm", {
                      locale: dateLocale,
                    })}
                  </time>
                  {notification.action ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        notification.action?.onClick();
                      }}
                    >
                      {notification.action.label}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function NotificationCenter() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const dateLocale = locale === "zh-CN" ? zhCN : enUS;
  const notifications = useNotificationsList();
  const unreadCount = useUnreadCount();
  const { markAllAsRead, clear } = useNotificationActions();
  const { isOpen, setOpen } = useNotificationSheet();

  const grouped = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const groups: {
      today: NotificationItem[];
      yesterday: NotificationItem[];
      older: NotificationItem[];
    } = {
      today: [],
      yesterday: [],
      older: [],
    };

    notifications.forEach((notification) => {
      const timestamp = normalizeNotificationTimestamp(notification.timestamp);
      if (timestamp >= today) {
        groups.today.push(notification);
      } else if (timestamp >= yesterday) {
        groups.yesterday.push(notification);
      } else {
        groups.older.push(notification);
      }
    });

    return groups;
  }, [notifications]);

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent className="w-[420px] sm:w-[460px] sm:max-w-[460px]">
        <SheetHeader className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4" />
              {t("title")}
              {unreadCount > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </SheetTitle>

            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                variant="ghost"
                label={t("markAllRead")}
                onClick={markAllAsRead}
                disabled={unreadCount === 0}
              >
                <CheckCheck className="size-4" />
              </IconButton>
              <IconButton size="sm" variant="ghost" label={t("clear")} onClick={clear}>
                <Trash2 className="size-4" />
              </IconButton>
              <IconButton size="sm" variant="ghost" label={t("settings")}>
                <Settings className="size-4" />
              </IconButton>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100%-56px)] pr-1">
          {notifications.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 text-center">
              <Bell className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("noNotifications")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.today.length > 0 ? (
                <NotificationTimelineGroup
                  title={t("today")}
                  items={grouped.today}
                  dateLocale={dateLocale}
                />
              ) : null}
              {grouped.yesterday.length > 0 ? (
                <NotificationTimelineGroup
                  title={t("yesterday")}
                  items={grouped.yesterday}
                  dateLocale={dateLocale}
                />
              ) : null}
              {grouped.older.length > 0 ? (
                <NotificationTimelineGroup
                  title={t("older")}
                  items={grouped.older}
                  dateLocale={dateLocale}
                />
              ) : null}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export function NotificationBell() {
  const { toggle } = useNotificationSheet();
  const unreadCount = useUnreadCount();
  const t = useTranslations("common.header");

  return (
    <IconButton
      variant="surface"
      size="md"
      label={t("notifications")}
      onClick={toggle}
      className="relative"
    >
      <Bell className="size-4" />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </IconButton>
  );
}
