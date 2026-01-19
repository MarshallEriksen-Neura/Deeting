"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AgentCard } from "@/components/assistants/agent-card"
import { InstalledAssistantCard } from "@/components/assistants/installed-assistant-card"
import { InfiniteList } from "@/components/ui/infinite-list"
import { installAssistant, updateAssistantInstall } from "@/lib/api"
import { useAssistantMarket } from "@/lib/swr/use-assistant-market"
import { useAssistantTags } from "@/lib/swr/use-assistant-tags"
import { useAssistantOwned } from "@/lib/swr/use-assistant-owned"
import { useAssistantInstalls } from "@/lib/swr/use-assistant-installs"
import type { AssistantCardData } from "@/components/assistants/types"
import { toast } from "sonner"

const PAGE_SIZE = 8
const COLOR_OPTIONS = [
  "from-blue-500 to-cyan-500",
  "from-pink-500 to-rose-500",
  "from-emerald-500 to-teal-500",
  "from-violet-500 to-purple-500",
  "from-orange-400 to-amber-500",
  "from-fuchsia-500 to-pink-500",
]

const pickColor = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 10000
  }
  return COLOR_OPTIONS[hash % COLOR_OPTIONS.length]
}

const normalizeTags = (tags: string[] = []) =>
  tags
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)

const matchesQuery = (agent: AssistantCardData, query: string) => {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    agent.name.toLowerCase().includes(q) ||
    agent.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}

export default function AssistantsPage() {
  const t = useTranslations("assistants")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])

  const {
    items: marketItems,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    reset,
    mutate: mutateMarket,
  } = useAssistantMarket({
    q: searchQuery,
    tags: selectedTags,
    size: PAGE_SIZE,
  })

  const { items: ownedItems, isLoading: ownedLoading } = useAssistantOwned(20)
  const { tags: marketTags } = useAssistantTags()
  const {
    items: installedItems,
    isLoading: isLoadingInstalls,
    mutate: mutateInstalls,
  } = useAssistantInstalls(20)
  const [updatingInstall, setUpdatingInstall] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    reset()
  }, [searchQuery, selectedTags, reset])

  const ownedCards = React.useMemo<AssistantCardData[]>(() => {
    return ownedItems
      .map((assistant) => {
        const current =
          assistant.versions.find((v) => v.id === assistant.current_version_id) ||
          assistant.versions[0]
        if (!current) return null
        return {
          id: assistant.id,
          name: current.name,
          description: assistant.summary || current.description || "",
          tags: normalizeTags(current.tags),
          installCount: assistant.install_count || 0,
          ratingAvg: assistant.rating_avg || 0,
          installed: true,
          iconId: assistant.icon_id,
          ownerUserId: assistant.owner_user_id,
          summary: assistant.summary,
          author: assistant.owner_user_id ? t("author.me") : t("author.system"),
          color: pickColor(assistant.id),
        }
      })
      .filter(Boolean) as AssistantCardData[]
  }, [ownedItems, t])

  const marketCards = React.useMemo<AssistantCardData[]>(() => {
    return marketItems.map((item) => ({
      id: item.assistant_id,
      name: item.version.name,
      description: item.summary || item.version.description || "",
      tags: normalizeTags(item.tags.length ? item.tags : item.version.tags),
      installCount: item.install_count || 0,
      ratingAvg: item.rating_avg || 0,
      installed: item.installed || false,
      iconId: item.icon_id,
      ownerUserId: item.owner_user_id,
      summary: item.summary,
      author: item.owner_user_id ? t("author.community") : t("author.system"),
      color: pickColor(item.assistant_id),
    }))
  }, [marketItems, t])

  const ownedIds = React.useMemo(
    () => new Set(ownedCards.map((agent) => agent.id)),
    [ownedCards]
  )

  const filteredOwned = React.useMemo(
    () =>
      ownedCards.filter(
        (agent) =>
          matchesQuery(agent, searchQuery) &&
          (selectedTags.length === 0 ||
            agent.tags.some((tag) => selectedTags.includes(tag)))
      ),
    [ownedCards, searchQuery, selectedTags]
  )

  const mergedAgents = React.useMemo(() => {
    const marketOnly = marketCards.filter((agent) => !ownedIds.has(agent.id))
    return [...filteredOwned, ...marketOnly]
  }, [filteredOwned, marketCards, ownedIds])

  const isInitialLoading = (isLoading || ownedLoading) && mergedAgents.length === 0

  const handleInstall = React.useCallback(
    async (assistantId: string, options?: { followLatest?: boolean }) => {
      await installAssistant(
        assistantId,
        options ? { follow_latest: options.followLatest } : undefined
      )
      await mutateMarket()
    },
    [mutateMarket]
  )

  const handleToggleFollowLatest = React.useCallback(
    async (assistantId: string, followLatest: boolean) => {
      setUpdatingInstall((prev) => ({ ...prev, [assistantId]: true }))
      try {
        await updateAssistantInstall(assistantId, { follow_latest: followLatest })
        await mutateInstalls()
        toast.success(t("toast.followLatestUpdatedTitle"), {
          description: t("toast.followLatestUpdatedDesc"),
        })
      } catch (error) {
        toast.error(t("toast.followLatestUpdateFailedTitle"), {
          description: t("toast.followLatestUpdateFailedDesc"),
        })
      } finally {
        setUpdatingInstall((prev) => ({ ...prev, [assistantId]: false }))
      }
    },
    [mutateInstalls, t]
  )

  return (
    <div className="min-h-screen bg-muted/20 p-8 space-y-8 animate-in fade-in duration-700">
      
      {/* 1. 顶部搜索区 */}
      <div className="text-center space-y-4 max-w-2xl mx-auto py-10 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[150%] bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 blur-3xl -z-10 opacity-50 rounded-full pointer-events-none" />
        
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("page.hero.titlePrefix")}{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-blue-600">
            {t("page.hero.titleHighlight")}
          </span>
        </h1>
        <p className="text-muted-foreground text-lg">
          {t("page.hero.subtitle")}
        </p>

        {/* Create Button moved to Chat */}

        <div className="relative group max-w-lg mx-auto mt-8">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-1000"></div>
          <div className="relative flex items-center bg-background rounded-xl shadow-xl border border-border/50">
             <Search className="ml-4 text-muted-foreground" />
             <Input 
               className="border-none shadow-none focus-visible:ring-0 text-lg py-6 bg-transparent" 
               placeholder={t("page.search.placeholder")}
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
             />
          </div>
        </div>

        <div className="flex justify-center gap-2 pt-4 flex-wrap">
          {marketTags.slice(0, 12).map((tag) => {
            const label = tag.name.replace(/^#/, "")
            const active = selectedTags.includes(label)
            return (
              <Badge
                key={tag.id}
                variant={active ? "default" : "secondary"}
                className="cursor-pointer hover:bg-secondary/80 px-3 py-1 transition-colors"
                onClick={() => {
                  setSelectedTags((prev) =>
                    prev.includes(label)
                      ? prev.filter((t) => t !== label)
                      : [...prev, label]
                  )
                }}
              >
                #{label}
              </Badge>
            )
          })}
        </div>
      </div>

      {/* 2. 已安装列表 */}
      {isLoadingInstalls ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </div>
      ) : installedItems.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">
              {t("page.installed.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("page.installed.subtitle")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {installedItems.map((item) => (
              <InstalledAssistantCard
                key={item.id}
                item={item}
                isUpdating={Boolean(updatingInstall[item.assistant_id])}
                onToggleFollowLatest={handleToggleFollowLatest}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 3. 助手网格 (使用 InfiniteList) */}
      <InfiniteList
        isLoading={isLoadingMore}
        isError={!!error}
        hasMore={hasMore}
        onLoadMore={loadMore}
        useScrollArea={false} // 使用 Body 滚动
        className="pb-20"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* 初始 Loading 骨架屏 */}
          {isInitialLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-4">
                <div className="h-24 bg-muted rounded-lg animate-pulse" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <div className="space-y-2 pt-4">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))
          ) : (
            mergedAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onInstall={handleInstall} />
            ))
          )}
        </div>
      </InfiniteList>
    </div>
  )
}
