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
  feishu: "bg-blue-500/10 text-blue-500",
  wechat: "bg-emerald-500/10 text-emerald-500",
  dingtalk: "bg-sky-500/10 text-sky-500",
  telegram: "bg-cyan-500/10 text-cyan-500",
  email: "bg-amber-500/10 text-amber-500",
  webhook: "bg-violet-500/10 text-violet-500",
}

export const isDesktopRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
