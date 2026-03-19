import { Suspense } from "react"
import { ChatRouteClientMemo as ChatRouteClient } from "@/components/chat/routing/chat-route-client"

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatRouteClient />
    </Suspense>
  )
}
