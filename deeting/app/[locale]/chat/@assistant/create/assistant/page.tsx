import { Suspense } from "react"
import { CreateAssistantSlot } from "@/components/common/agent-selection"

export default function CreateAssistantModal() {
  return (
    <Suspense fallback={null}>
      <CreateAssistantSlot />
    </Suspense>
  )
}
