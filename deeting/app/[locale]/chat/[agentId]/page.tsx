import { Suspense } from "react"
import { ChatContainer } from "../components/chat-container"
import { ChatSkeleton } from "../components/chat-skeleton"

interface ChatPageProps {
  params: Promise<{ agentId: string }>
}

export default async function AgentChatPage({ params }: ChatPageProps) {
  const { agentId } = await params

  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContainer agentId={agentId} />
    </Suspense>
  )
}