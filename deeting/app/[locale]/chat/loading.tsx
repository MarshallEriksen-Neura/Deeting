import { ChatRouteFallback } from "@/components/chat/routing/chat-route-fallback"

export default function ChatLoading() {
  return (
    <ChatRouteFallback
      label="Loading chat"
      detail="Preparing the chat shell while restoring route state"
    />
  )
}
