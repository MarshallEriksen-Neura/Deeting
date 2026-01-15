"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AgentCard } from "@/components/assistants/agent-card"
import { InfiniteList } from "@/components/ui/infinite-list"
import { CreateAgentModal } from "@/components/assistants/create-agent-modal"
import { useMarketStore, type Agent } from "@/store/market-store"

// 基础模拟数据
const BASE_AGENTS: Agent[] = [
  {
    id: "1",
    name: "全栈架构师",
    desc: "精通 React, Node.js, Rust。能帮你重构代码并解释设计模式。无论是微服务架构还是前端性能优化，都能提供专业建议。",
    tags: ["Coding", "Architecture", "Rust"],
    installs: "12.5k",
    rating: 4.9,
    author: "Deeting Team",
    color: "from-blue-500 to-cyan-500"
  },
  {
    id: "2",
    name: "小红书爆款写手",
    desc: "熟知种草逻辑，自动生成 Emoji，标题党专家。只需输入关键词，即可生成吸引眼球的文案。",
    tags: ["Social", "Copywriting", "Marketing"],
    installs: "8.2k",
    rating: 4.7,
    author: "Community",
    color: "from-pink-500 to-rose-500"
  },
  {
    id: "3",
    name: "数据分析师",
    desc: "擅长 Python Pandas, SQL。上传 CSV，立刻生成可视化图表建议和数据洞察。",
    tags: ["Data", "Python", "Analysis"],
    installs: "5.1k",
    rating: 4.8,
    author: "DataWizard",
    color: "from-emerald-500 to-teal-500"
  },
  {
    id: "4",
    name: "塔罗牌占卜",
    desc: "神秘学专家，为你解读每日运势。支持牌阵分析和心理咨询。",
    tags: ["Fun", "Mystic"],
    installs: "15k",
    rating: 4.6,
    author: "Luna",
    color: "from-violet-500 to-purple-500"
  },
  {
    id: "5",
    name: "英语口语私教",
    desc: "模拟雅思口语考试场景，实时纠正语法错误，提供更地道的表达方式。",
    tags: ["Education", "Language"],
    installs: "3.2k",
    rating: 4.9,
    author: "EduTech",
    color: "from-orange-400 to-amber-500"
  },
  {
    id: "6",
    name: "UX 设计顾问",
    desc: "提供用户体验改进建议，分析界面交互流程，支持 Material Design 和 iOS HIG 规范。",
    tags: ["Design", "UX/UI"],
    installs: "4.5k",
    rating: 4.8,
    author: "DesignLab",
    color: "from-fuchsia-500 to-pink-500"
  }
]

// 生成更多模拟数据以演示滚动
const SAMPLE_AGENTS = Array.from({ length: 30 }).map((_, i) => ({
  ...BASE_AGENTS[i % BASE_AGENTS.length],
  id: `${i}`, // 确保 ID 唯一
  name: `${BASE_AGENTS[i % BASE_AGENTS.length].name} ${Math.floor(i / 6) + 1}`,
}))

const PAGE_SIZE = 8

export default function AssistantsPage() {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [displayedAgents, setDisplayedAgents] = React.useState<Agent[]>([])
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [hasMore, setHasMore] = React.useState(true)
  const [isInitialLoading, setIsInitialLoading] = React.useState(true)

  const createdAgents = useMarketStore((state) => state.createdAgents)
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // 模拟初始加载 (合并用户创建的助手)
  React.useEffect(() => {
    if (!mounted) return

    const timer = setTimeout(() => {
      // 初始数据 = 用户创建的 + 市场第一页
      setDisplayedAgents([...createdAgents, ...SAMPLE_AGENTS.slice(0, PAGE_SIZE)])
      setIsLoading(false)
      setIsInitialLoading(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [mounted, createdAgents])

  // 模拟加载更多
  const loadMore = React.useCallback(() => {
    if (isLoading || !hasMore) return

    setIsLoading(true)
    setTimeout(() => {
      const nextPage = page + 1
      const start = (nextPage - 1) * PAGE_SIZE
      const newAgents = SAMPLE_AGENTS.slice(start, start + PAGE_SIZE)
      
      if (newAgents.length === 0) {
        setHasMore(false)
      } else {
        setDisplayedAgents(prev => [...prev, ...newAgents])
        setPage(nextPage)
      }
      setIsLoading(false)
    }, 1000)
  }, [page, isLoading, hasMore])

  // 搜索过滤 (涵盖所有数据)
  const filteredAgents = React.useMemo(() => {
    if (!searchQuery) return displayedAgents
    
    // 搜索时，我们需要在 "用户创建的" + "所有市场模拟数据" 中搜索
    const allSource = [...createdAgents, ...SAMPLE_AGENTS]
    return allSource.filter(agent => 
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  }, [searchQuery, displayedAgents, createdAgents])

  const isSearching = !!searchQuery

  return (
    <div className="min-h-screen bg-muted/20 p-8 space-y-8 animate-in fade-in duration-700">
      
      {/* 1. 顶部搜索区 */}
      <div className="text-center space-y-4 max-w-2xl mx-auto py-10 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[150%] bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 blur-3xl -z-10 opacity-50 rounded-full pointer-events-none" />
        
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          发现你的下一个 <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-blue-600">数字伙伴</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          不仅仅是 Prompt，而是具有独特人格和技能的智能体
        </p>

        {/* Create Button */}
        <div className="flex justify-center mt-4">
           <CreateAgentModal />
        </div>

        <div className="relative group max-w-lg mx-auto mt-8">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-1000"></div>
          <div className="relative flex items-center bg-background rounded-xl shadow-xl border border-border/50">
             <Search className="ml-4 text-muted-foreground" />
             <Input 
               className="border-none shadow-none focus-visible:ring-0 text-lg py-6 bg-transparent" 
               placeholder="搜索助手能力 (e.g. Python, 写作...)" 
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
             />
          </div>
        </div>

        <div className="flex justify-center gap-2 pt-4 flex-wrap">
           <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80 px-3 py-1 transition-colors">🔥 Trending</Badge>
           <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80 px-3 py-1 transition-colors">💻 Development</Badge>
           <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80 px-3 py-1 transition-colors">🎨 Design</Badge>
           <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80 px-3 py-1 transition-colors">📈 Productivity</Badge>
        </div>
      </div>

      {/* 2. 助手网格 (使用 InfiniteList) */}
      <InfiniteList
        isLoading={isLoading}
        hasMore={!isSearching && hasMore}
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
            filteredAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))
          )}
        </div>
      </InfiniteList>
    </div>
  )
}