import { Suspense } from "react"
import { redirect } from "next/navigation"
import { SelectAgentContainer } from "@/components/common/agent-selection"
import { SelectAgentSkeleton } from "@/components/common/skeletons"

export default function SelectAgentPage() {
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  if (!isTauri) {
    redirect("/chat")
  }
  return (
    <Suspense fallback={<SelectAgentSkeleton />}>
      <SelectAgentContainer />
    </Suspense>
  )
}
