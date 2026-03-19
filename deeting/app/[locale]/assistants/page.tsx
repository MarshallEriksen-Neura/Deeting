"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AgentCard } from "@/components/assistants/agent-card"
import { AssistantsStatePanel } from "@/components/assistants/assistants-state-panel"
import { CreateAgentModal } from "@/components/assistants/create-agent-modal"
import { InfiniteList } from "@/components/ui/infinite-list"
import { deleteAssistant, deleteLocalAssistant, installAssistant } from "@/lib/api"
import { useLocalAssistants } from "@/lib/swr/use-local-assistants"
import { useAssistantMarket } from "@/lib/swr/use-assistant-market"
import { useAssistantTags } from "@/lib/swr/use-assistant-tags"
import { useAssistantOwned } from "@/lib/swr/use-assistant-owned"
import { isTauriRuntime as resolveTauriRuntime } from "@/lib/runtime/tauri"
import type { AssistantCardData } from "@/components/assistants/types"

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

type EditableAssistant = {
  id: string
  name: string
  desc: string
  systemPrompt: string
  tags: string[]
  iconId: string
  color: string
  visibility?: string
}

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
  const isTauriRuntime = resolveTauriRuntime()
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
  }, { enabled: !isTauriRuntime })

  const {
    items: ownedItems,
    isLoading: ownedLoading,
    mutate: mutateOwned,
  } = useAssistantOwned(20, { enabled: !isTauriRuntime })
  const { tags: cloudTags } = useAssistantTags(!isTauriRuntime)
  const {
    items: localAssistantItems,
    isLoading: localAssistantsLoading,
    error: localAssistantsError,
    mutate: mutateLocalAssistants,
  } = useLocalAssistants(isTauriRuntime)
  const localTags = React.useMemo(() => {
    const tagMap = new Map<string, { id: string; name: string }>()
    localAssistantItems.forEach((assistant) => {
      normalizeTags(assistant.tags).forEach((tag) => {
        const key = tag.toLowerCase()
        if (!tagMap.has(key)) {
          tagMap.set(key, { id: `local-tag:${key}`, name: tag })
        }
      })
    })
    return Array.from(tagMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  }, [localAssistantItems])
  const marketTags = isTauriRuntime ? localTags : cloudTags

  React.useEffect(() => {
    reset()
  }, [searchQuery, selectedTags, reset])

  const [modalOpen, setModalOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<EditableAssistant | undefined>(undefined)

  const cloudOwnedEditableMap = React.useMemo(() => {
    const map: Record<string, EditableAssistant> = {}
    ownedItems.forEach((assistant) => {
      const current =
        assistant.versions.find((v) => v.id === assistant.current_version_id) ||
        assistant.versions[0]
      if (!current) return
      map[assistant.id] = {
        id: assistant.id,
        name: current.name,
        desc: assistant.summary || current.description || "",
        systemPrompt: current.system_prompt || "",
        tags: normalizeTags(current.tags || []),
        iconId: assistant.icon_id || "lucide:bot",
        color: pickColor(assistant.id),
        visibility: assistant.visibility,
      }
    })
    return map
  }, [ownedItems])

  const localEditableMap = React.useMemo(() => {
    const map: Record<string, EditableAssistant> = {}
    localAssistantItems.forEach((assistant) => {
      map[assistant.id] = {
        id: assistant.id,
        name: assistant.name,
        desc: assistant.description || "",
        systemPrompt: assistant.system_prompt,
        tags: normalizeTags(assistant.tags),
        iconId: assistant.avatar || "lucide:bot",
        color: pickColor(assistant.id),
        visibility: assistant.visibility,
      }
    })
    return map
  }, [localAssistantItems])

  const handleCreate = React.useCallback(() => {
    setEditing(undefined)
    setModalOpen(true)
  }, [])

  const handleEdit = React.useCallback(
    (assistantId: string) => {
      const target = isTauriRuntime
        ? localEditableMap[assistantId]
        : cloudOwnedEditableMap[assistantId]
      if (!target) return
      setEditing(target)
      setModalOpen(true)
    },
    [cloudOwnedEditableMap, isTauriRuntime, localEditableMap]
  )

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
          isOwned: true,
          iconId: assistant.icon_id,
          ownerUserId: assistant.owner_user_id,
          summary: assistant.summary,
          author: assistant.owner_user_id ? t("author.me") : t("author.system"),
          color: pickColor(assistant.id),
        }
      })
      .filter(Boolean) as AssistantCardData[]
  }, [ownedItems, t])

  const localCards = React.useMemo<AssistantCardData[]>(() => {
    return localAssistantItems.map((assistant) => ({
      id: assistant.id,
      name: assistant.name,
      description: assistant.description || "",
      tags: normalizeTags(assistant.tags),
      installCount: 0,
      ratingAvg: 0,
      installed: true,
      isOwned: assistant.visibility !== "public",
      iconId: assistant.avatar,
      summary: assistant.description,
      author: assistant.visibility === "public" ? t("author.system") : t("author.me"),
      color: pickColor(assistant.id),
      visibility: assistant.visibility as AssistantCardData["visibility"],
    }))
  }, [localAssistantItems, t])

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

  const filteredLocal = React.useMemo(
    () =>
      localCards.filter(
        (agent) =>
          matchesQuery(agent, searchQuery) &&
          (selectedTags.length === 0 ||
            agent.tags.some((tag) => selectedTags.includes(tag)))
      ),
    [localCards, searchQuery, selectedTags]
  )

  const mergedAgents = React.useMemo(() => {
    if (isTauriRuntime) {
      return filteredLocal
    }
    const marketOnly = marketCards.filter((agent) => !ownedIds.has(agent.id))
    return [...filteredOwned, ...marketOnly]
  }, [filteredLocal, filteredOwned, isTauriRuntime, marketCards, ownedIds])

  const isInitialLoading = isTauriRuntime
    ? localAssistantsLoading && mergedAgents.length === 0
    : (isLoading || ownedLoading) && mergedAgents.length === 0
  const shouldShowBlockingLoadError = isTauriRuntime
    ? !!localAssistantsError && mergedAgents.length === 0
    : !!error && mergedAgents.length === 0
  const blockingErrorMessage = React.useMemo(() => {
    const target = isTauriRuntime ? localAssistantsError : error
    if (!target) return null
    if (target instanceof Error && target.message.trim()) return target.message
    return null
  }, [error, isTauriRuntime, localAssistantsError])
  const isFilteredView = searchQuery.trim().length > 0 || selectedTags.length > 0
  const stateKind = isInitialLoading
    ? "loading"
    : shouldShowBlockingLoadError
      ? "error"
      : mergedAgents.length === 0
        ? "empty"
        : null

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
  const handleDelete = React.useCallback(
    async (assistantId: string) => {
      if (isTauriRuntime) {
        await deleteLocalAssistant(assistantId)
        await mutateLocalAssistants()
        return
      }

      await deleteAssistant(assistantId)
      await Promise.all([mutateOwned(), mutateMarket()])
    },
    [isTauriRuntime, mutateLocalAssistants, mutateMarket, mutateOwned]
  )
  const handleRetry = React.useCallback(() => {
    if (isTauriRuntime) {
      void mutateLocalAssistants()
      return
    }
    void mutateOwned()
    void mutateMarket()
  }, [isTauriRuntime, mutateLocalAssistants, mutateMarket, mutateOwned])
  const handleClearFilters = React.useCallback(() => {
    setSearchQuery("")
    setSelectedTags([])
  }, [])

  return (
    <div className="min-h-screen bg-muted/20 p-8 space-y-8 animate-in fade-in duration-700">
      <CreateAgentModal
        mode={isTauriRuntime ? "local" : "cloud"}
        trigger={null}
        open={modalOpen}
        onOpenChange={setModalOpen}
        assistant={editing}
        onCreated={() => {
          if (isTauriRuntime) {
            mutateLocalAssistants()
            return
          }
          mutateOwned()
          mutateMarket()
        }}
        onUpdated={() => {
          if (isTauriRuntime) {
            mutateLocalAssistants()
            return
          }
          mutateOwned()
          mutateMarket()
        }}
        onDeleted={() => {
          if (isTauriRuntime) {
            mutateLocalAssistants()
            return
          }
          mutateOwned()
          mutateMarket()
        }}
      />
      
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

        <div className="flex justify-center pt-2">
          <Button
            onClick={handleCreate}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg border-0"
          >
            {t("create.trigger")}
          </Button>
        </div>

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

      {/* 3. 助手内容区 */}
      {stateKind ? (
        <AssistantsStatePanel
          kind={stateKind}
          isFiltered={stateKind === "empty" ? isFilteredView : false}
          errorMessage={blockingErrorMessage}
          onRetry={stateKind === "error" ? handleRetry : undefined}
          onClearFilters={stateKind === "empty" && isFilteredView ? handleClearFilters : undefined}
          onCreate={stateKind === "empty" && !isFilteredView ? handleCreate : undefined}
          className="pb-4"
        />
      ) : (
        <InfiniteList
          isLoading={isTauriRuntime ? false : isLoadingMore}
          isError={false}
          hasMore={isTauriRuntime ? false : hasMore}
          onLoadMore={isTauriRuntime ? undefined : loadMore}
          useScrollArea={false}
          className="pb-20"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {mergedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onInstall={isTauriRuntime ? undefined : handleInstall}
                onEdit={handleEdit}
                onDelete={agent.isOwned ? handleDelete : undefined}
              />
            ))}
          </div>
        </InfiniteList>
      )}
    </div>
  )
}
