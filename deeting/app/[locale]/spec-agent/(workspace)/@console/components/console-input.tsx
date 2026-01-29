'use client'

import { memo } from 'react'
import { Send, Paperclip, Smile, Settings2, Puzzle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ConsoleInputProps = {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  onSend: () => void
}

export const ConsoleInput = memo(function ConsoleInput({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onSend,
}: ConsoleInputProps) {
  return (
    <div className="flex-shrink-0 border-t border-border/30 bg-gradient-to-t from-muted/20 to-transparent">
      {/* 配置标签栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
            'text-[11px] font-medium text-muted-foreground',
            'bg-muted/30 hover:bg-muted/50',
            'border border-border/30 hover:border-border/50',
            'transition-all duration-200',
            'cursor-pointer'
          )}
        >
          <Settings2 className="h-3 w-3" />
          执行配置
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
            'text-[11px] font-medium text-muted-foreground',
            'bg-muted/30 hover:bg-muted/50',
            'border border-border/30 hover:border-border/50',
            'transition-all duration-200',
            'cursor-pointer'
          )}
        >
          <Puzzle className="h-3 w-3" />
          MCP 服务器
        </button>
      </div>

      {/* 输入区域 - 毛玻璃卡片 */}
      <div className="p-3">
        <div
          className={cn(
            'relative rounded-2xl',
            'bg-card/60 backdrop-blur-sm',
            'border border-border/40',
            'shadow-sm',
            'transition-all duration-200',
            'focus-within:border-primary/30 focus-within:shadow-md focus-within:shadow-primary/5'
          )}
        >
          {/* 输入框 */}
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={cn(
              'min-h-[44px] max-h-[120px] resize-none',
              'border-0 bg-transparent',
              'text-sm px-4 py-3',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
              'placeholder:text-muted-foreground/50'
            )}
            rows={1}
          />

          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/20">
            {/* 左侧工具按钮 */}
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 rounded-xl',
                  'text-muted-foreground/70 hover:text-foreground',
                  'hover:bg-muted/50',
                  'transition-colors'
                )}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 rounded-xl',
                  'text-muted-foreground/70 hover:text-foreground',
                  'hover:bg-muted/50',
                  'transition-colors'
                )}
              >
                <Smile className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 rounded-xl',
                  'text-muted-foreground/70 hover:text-foreground',
                  'hover:bg-muted/50',
                  'transition-colors'
                )}
              >
                <Sparkles className="h-4 w-4" />
              </Button>
            </div>

            {/* 发送按钮 */}
            <Button
              onClick={onSend}
              disabled={!value.trim()}
              size="icon"
              className={cn(
                'h-9 w-9 rounded-xl',
                'bg-primary hover:bg-primary/90',
                'shadow-lg shadow-primary/20',
                'transition-all duration-200',
                'disabled:opacity-40 disabled:shadow-none'
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})
