"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CreateAgentModal } from "@/components/assistants/create-agent-modal"

export default function CreateAssistantSlot() {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        router.replace("/chat")
      }
    },
    [router]
  )

  const handleCreated = React.useCallback(
    (assistantId?: string) => {
      if (assistantId) {
        router.replace(`/chat/${encodeURIComponent(assistantId)}`)
      } else {
        router.replace("/chat")
      }
    },
    [router]
  )

  return (
    <CreateAgentModal
      mode={isTauri ? "local" : "cloud"}
      open={open}
      onOpenChange={handleOpenChange}
      onCreated={handleCreated}
      trigger={null}
    />
  )
}
