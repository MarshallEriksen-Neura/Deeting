export type AssistantCardData = {
  id: string
  name: string
  description: string
  tags: string[]
  installCount: number
  ratingAvg: number
  installed: boolean
  iconId?: string | null
  ownerUserId?: string | null
  summary?: string | null
  author?: string
  color: string
}
