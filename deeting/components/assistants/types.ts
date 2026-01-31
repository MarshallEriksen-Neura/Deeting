export type AssistantVisibility = "private" | "public" | "unlisted"
export type AssistantStatus = "draft" | "published" | "archived"

export type AssistantCardData = {
  id: string
  name: string
  description: string
  tags: string[]
  installCount: number
  ratingAvg: number
  installed: boolean
  isOwned?: boolean
  iconId?: string | null
  ownerUserId?: string | null
  summary?: string | null
  author?: string
  color: string
  visibility?: AssistantVisibility
  status?: AssistantStatus
}
