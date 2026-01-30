import { redirect } from "next/navigation"
import { ChatRouteClientMemo as ChatRouteClient } from "@/components/chat/routing/chat-route-client"

export default function AgentChatPage() {
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  if (!isTauri) {
    redirect("/chat")
  }
  return <ChatRouteClient />
}
