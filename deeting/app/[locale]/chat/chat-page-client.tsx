"use client"

import dynamic from "next/dynamic"

import { ChatRouteFallback } from "@/components/chat/routing/chat-route-fallback"

const ChatRouteClient = dynamic(
  () =>
    import("@/components/chat/routing/chat-route-client").then(
      (mod) => mod.ChatRouteClientMemo
    ),
  {
    ssr: false,
    loading: () => <ChatRouteFallback />,
  }
)

export function ChatPageClient() {
  return <ChatRouteClient />
}
