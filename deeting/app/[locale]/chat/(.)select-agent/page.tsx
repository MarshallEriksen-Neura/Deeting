import { Suspense } from "react"
import { SelectAgentContainer } from "@/components/common/agent-selection"
import { SelectAgentSkeleton } from "@/components/common/skeletons"

export default function SelectAgentPage() {
  return (
    <Suspense fallback={<SelectAgentSkeleton />}>
      <SelectAgentContainer />
    </Suspense>
  )
}
