import { Suspense } from "react"
import CreateAssistantSlot from "../../../components/create-assistant-slot"

export default function CreateAssistantModal() {
  return (
    <Suspense fallback={null}>
      <CreateAssistantSlot />
    </Suspense>
  )
}
