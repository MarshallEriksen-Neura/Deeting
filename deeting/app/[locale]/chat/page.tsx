import { Suspense } from "react"
import { ChatRouteClientMemo as ChatRouteClient } from "@/components/chat/routing/chat-route-client"
import { ChatRouteFallback } from "@/components/chat/routing/chat-route-fallback"

export default function Page() {
  return (
    <Suspense fallback={<ChatRouteFallback />}>
      <ChatRouteClient />
    </Suspense>
  )
}
