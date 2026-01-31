import type { AssistantStatus, AssistantVisibility } from "./types"

export function getAssistantStatusLabel(
  visibility: AssistantVisibility,
  status: AssistantStatus
) {
  if (status === "archived") return "archived"
  if (visibility === "public" && status === "published") return "published"
  return "draft"
}
