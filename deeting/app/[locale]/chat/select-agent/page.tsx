import { redirect } from "next/navigation"

export default function SelectAgentPage() {
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  if (!isTauri) {
    redirect("/chat")
  }
  redirect("/dashboard/user/task-agents")
}
