import { Globe, Mail, MessageCircleMore, MessageSquare, Send } from "lucide-react"

import type { ChannelType } from "@/lib/api/notification-channels"

export const CHANNEL_ICONS: Record<ChannelType, typeof Mail> = {
  feishu: MessageSquare,
  wechat: MessageCircleMore,
  dingtalk: MessageSquare,
  telegram: Send,
  email: Mail,
  webhook: Globe,
}

export const CHANNEL_COLORS: Record<ChannelType, string> = {
  feishu: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
  wechat: "bg-[color:var(--ok-soft)] text-[color:var(--ok)]",
  dingtalk: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
  telegram: "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]",
  email: "bg-[color:var(--warn-soft)] text-[color:var(--warn)]",
  webhook: "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]",
}

export const isDesktopRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
