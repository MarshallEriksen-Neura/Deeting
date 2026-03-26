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
  feishu: "bg-blue-500/10 text-blue-400",
  wechat: "bg-emerald-500/10 text-emerald-400",
  dingtalk: "bg-sky-500/10 text-sky-400",
  telegram: "bg-cyan-500/10 text-cyan-400",
  email: "bg-amber-500/10 text-amber-400",
  webhook: "bg-purple-500/10 text-purple-400",
}

export const isDesktopRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

