'use client'

import { memo, useCallback } from 'react'
import {
  Send,
  Plus,
  Mic,
  Puzzle,
  FileSliders,
  Globe,
  Code2,
  Palette,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/hooks/use-i18n'
import { useConsoleState } from '../@console/hooks/use-console-state'

// 快捷操作按钮配置
const quickActions = [
  { id: 'slides', icon: FileSliders, labelKey: 'welcome.quickActions.slides' },
  { id: 'website', icon: Globe, labelKey: 'welcome.quickActions.website' },
  { id: 'app', icon: Code2, labelKey: 'welcome.quickActions.app' },
  { id: 'design', icon: Palette, labelKey: 'welcome.quickActions.design' },
  { id: 'more', icon: ArrowRight, labelKey: 'welcome.quickActions.more' },
]

// MCP 工具图标占位
const mcpIcons = ['🔍', '📧', '🗄️', '📊', '🔗', '📁']

function WelcomeViewInner() {
  const t = useI18n('spec-agent')
  const state = useConsoleState(t)

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        state.handleSend()
      }
    },
    [state]
  )

  const handleQuickAction = useCallback((actionId: string) => {
    // TODO: 实现快捷操作
    console.log('Quick action:', actionId)
  }, [])

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-b from-background to-background/95 px-6 py-12">
      {/* 渐变光晕背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[100px]" />
      </div>

      {/* 主内容区 */}
      <div className="relative z-10 w-full max-w-2xl flex flex-col items-center">
        {/* 大标题 - 带渐变效果 */}
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-2 bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text">
          {t('welcome.title')}
        </h1>

        {/* 副标题 */}
        <p className="text-muted-foreground text-center mb-10 text-lg">
          {t('welcome.subtitle')}
        </p>

        {/* 毛玻璃效果输入卡片 */}
        <div className="w-full">
          <div
            className={cn(
              'relative rounded-2xl',
              'bg-card/80 backdrop-blur-xl',
              'border border-border/50',
              'shadow-[0_8px_32px_rgba(0,0,0,0.08)]',
              'dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]',
              'transition-all duration-300',
              'hover:shadow-[0_12px_48px_rgba(0,0,0,0.12)]',
              'dark:hover:shadow-[0_12px_48px_rgba(0,0,0,0.32)]',
              'focus-within:ring-2 focus-within:ring-primary/20'
            )}
          >
            {/* 输入区域 */}
            <Textarea
              value={state.input}
              onChange={(e) => state.setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('welcome.inputPlaceholder')}
              className={cn(
                'min-h-[100px] resize-none border-0 bg-transparent',
                'px-5 py-4 text-base',
                'focus-visible:ring-0 focus-visible:ring-offset-0',
                'placeholder:text-muted-foreground/60'
              )}
              rows={3}
            />

            {/* 底部工具栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
              {/* 左侧工具按钮 */}
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Puzzle className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Mic className="h-5 w-5" />
                </Button>
              </div>

              {/* 发送按钮 */}
              <Button
                type="button"
                size="icon"
                className={cn(
                  'h-9 w-9 rounded-xl',
                  'bg-primary hover:bg-primary/90',
                  'shadow-lg shadow-primary/25',
                  'transition-all duration-200',
                  'disabled:opacity-50 disabled:shadow-none'
                )}
                onClick={state.handleSend}
                disabled={!state.input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* MCP 工具连接提示 */}
          <div className="flex items-center gap-2 mt-4 px-2">
            <Puzzle className="h-4 w-4 text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground/60">
              {t('welcome.mcpHint')}
            </span>
            <div className="flex items-center gap-1 ml-1">
              {mcpIcons.map((icon, i) => (
                <span
                  key={i}
                  className="w-5 h-5 flex items-center justify-center rounded-full bg-muted/50 text-[10px]"
                >
                  {icon}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 快捷操作按钮 */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction(action.id)}
                className={cn(
                  'h-10 px-4 rounded-xl',
                  'bg-card/60 backdrop-blur-sm',
                  'border-border/50 hover:border-primary/30',
                  'hover:bg-primary/5 hover:text-primary',
                  'transition-all duration-200',
                  'group'
                )}
              >
                <Icon className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform" />
                {t(action.labelKey)}
              </Button>
            )
          })}
        </div>
      </div>

      {/* 底部装饰 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-muted-foreground/40">
        <Sparkles className="h-3 w-3" />
        <span>Powered by Spec Agent</span>
      </div>
    </div>
  )
}

export const WelcomeView = memo(WelcomeViewInner)
