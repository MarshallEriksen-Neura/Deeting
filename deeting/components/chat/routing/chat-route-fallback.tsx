import { StartupShell } from "@/components/common/startup-shell"

type ChatRouteFallbackProps = {
  label?: string
  detail?: string
  badge?: string
}

const CHAT_ROUTE_STEPS = [
  {
    label: "Runtime",
    hint: "Restoring the desktop bridge and route state",
    state: "done" as const,
  },
  {
    label: "Session",
    hint: "Recovering authentication and conversation context",
    state: "active" as const,
  },
  {
    label: "Interface",
    hint: "Painting the chat surface and controls",
    state: "pending" as const,
  },
]

export function ChatRouteFallback({
  label = "Loading conversation",
  detail = "Preparing the desktop chat shell and restoring session context",
  badge = "Chat Startup",
}: ChatRouteFallbackProps) {
  return (
    <StartupShell
      label={label}
      detail={detail}
      badge={badge}
      steps={CHAT_ROUTE_STEPS}
    />
  )
}
