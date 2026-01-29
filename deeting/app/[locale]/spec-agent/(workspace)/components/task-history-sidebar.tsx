'use client'

import { memo, useState, useMemo } from 'react'
import {
  Plus,
  Search,
  Library,
  FolderPlus,
  SlidersHorizontal,
  Bot,
  Clock,
  Star,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'

interface TaskHistoryItem {
  id: string
  title: string
  timestamp: string
  starred?: boolean
  status: 'completed' | 'running' | 'failed'
}

// 模拟历史数据 - 后续从 store 或 API 获取
const mockHistoryItems: TaskHistoryItem[] = [
  { id: '1', title: '学习AI知识的资料和免费开发环境...', timestamp: '2小时前', status: 'completed' },
  { id: '2', title: '黑龙江农保如何缴纳', timestamp: '3小时前', status: 'completed' },
  { id: '3', title: 'Nextjs并行路由和拦截路由使用方法', timestamp: '5小时前', status: 'completed' },
  { id: '4', title: '如何突破项目自动化瓶颈?', timestamp: '昨天', status: 'completed' },
  { id: '5', title: '如何组合多个FastMCP到主MCP服务', timestamp: '昨天', status: 'completed' },
  { id: '6', title: '解释Google博客关于代理互操作性...', timestamp: '2天前', status: 'completed' },
  { id: '7', title: '读取理解fastmcp项目指南', timestamp: '2天前', status: 'completed' },
  { id: '8', title: '深入了解MCP模型上下文协议文件...', timestamp: '3天前', status: 'completed', starred: true },
  { id: '9', title: '接入mcp模型上下文协议的功...', timestamp: '3天前', status: 'completed', starred: true },
]

function TaskHistorySidebarInner() {
  const t = useI18n('spec-agent')
  const [searchQuery, setSearchQuery] = useState('')
  const resetStore = useSpecAgentStore((state) => state.reset)

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return mockHistoryItems
    return mockHistoryItems.filter(item =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [searchQuery])

  const handleNewTask = () => {
    // 重置 store 开始新任务
    resetStore()
  }

  const handleSelectTask = (taskId: string) => {
    // TODO: 加载历史任务
    console.log('Select task:', taskId)
  }

  return (
    <aside
      className={cn(
        'w-[280px] flex-shrink-0 h-full',
        'bg-card/95 dark:bg-card/90',
        'border-r border-border/50',
        'flex flex-col'
      )}
    >
      {/* 顶部操作区 */}
      <div className="flex-shrink-0 p-4 space-y-3">
        {/* 新建任务按钮 */}
        <Button
          onClick={handleNewTask}
          className={cn(
            'w-full h-10 justify-start gap-2',
            'bg-muted/50 hover:bg-muted/80',
            'text-foreground/90 hover:text-foreground',
            'border border-border/50 hover:border-border',
            'rounded-xl',
            'transition-all duration-200'
          )}
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">{t('taskHistory.newTask')}</span>
        </Button>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('taskHistory.searchPlaceholder')}
            className={cn(
              'h-10 pl-10 pr-4',
              'bg-muted/30 hover:bg-muted/50',
              'border-border/50 hover:border-border focus:border-primary/50',
              'text-foreground placeholder:text-muted-foreground/50',
              'rounded-xl',
              'transition-all duration-200'
            )}
          />
        </div>

        {/* 快捷操作 */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'flex-1 h-9 justify-start gap-2',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-muted/50',
              'rounded-lg'
            )}
          >
            <Library className="h-4 w-4" />
            <span className="text-xs">{t('taskHistory.library')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'flex-1 h-9 justify-start gap-2',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-muted/50',
              'rounded-lg'
            )}
          >
            <FolderPlus className="h-4 w-4" />
            <span className="text-xs">{t('taskHistory.newProject')}</span>
          </Button>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-4 h-px bg-border/50" />

      {/* 任务列表区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 列表标题 */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
            {t('taskHistory.allTasks')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 rounded-md"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 任务列表 */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 pb-4">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground/60">
                  {searchQuery ? t('taskHistory.noResults') : t('taskHistory.empty')}
                </p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectTask(item.id)}
                  className={cn(
                    'w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left',
                    'transition-all duration-200',
                    'hover:bg-muted/50',
                    'cursor-pointer group'
                  )}
                >
                  {/* 图标 */}
                  <div className={cn(
                    'flex-shrink-0 w-7 h-7 rounded-lg mt-0.5',
                    'bg-gradient-to-br from-primary/20 to-primary/10',
                    'flex items-center justify-center',
                    'ring-1 ring-primary/20'
                  )}>
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground/80 truncate group-hover:text-foreground transition-colors">
                        {item.title}
                      </span>
                      {item.starred && (
                        <Star className="h-3 w-3 flex-shrink-0 text-amber-400 fill-amber-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-3 w-3 text-muted-foreground/50" />
                      <span className="text-[11px] text-muted-foreground/50">
                        {item.timestamp}
                      </span>
                    </div>
                  </div>

                  {/* 更多操作 */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-6 w-6 flex-shrink-0',
                      'text-muted-foreground/40 hover:text-foreground',
                      'hover:bg-muted/70',
                      'rounded-md',
                      'opacity-0 group-hover:opacity-100',
                      'transition-all duration-200'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      // TODO: 显示更多操作菜单
                    }}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 底部品牌 */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border/50">
        <div className="flex items-center gap-2 text-muted-foreground/50">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-medium">Spec Agent</span>
        </div>
      </div>
    </aside>
  )
}

export const TaskHistorySidebar = memo(TaskHistorySidebarInner)
