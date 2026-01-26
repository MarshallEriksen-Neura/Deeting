'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

export default function Console() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    {
      id: '1',
      type: 'user',
      content: '帮我找一台32G内存的手机',
      timestamp: '12:34:56'
    },
    {
      id: '2',
      type: 'system',
      content: '✓ 已连接京东API (3.2s)',
      timestamp: '12:35:02'
    },
    {
      id: '3',
      type: 'agent',
      content: '⚡ 正在解析商品参数...',
      timestamp: '12:35:18'
    }
  ])

  const handleSend = () => {
    if (!input.trim()) return

    const newMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: input,
      timestamp: new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }

    setMessages(prev => [...prev, newMessage])
    setInput('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-foreground">Console</h2>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages.map((message) => (
            <div key={message.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{message.timestamp}</span>
                <span className="uppercase font-medium">
                  {message.type === 'user' ? 'USER' :
                   message.type === 'system' ? 'SYSTEM' : 'AGENT'}
                </span>
              </div>
              <div className={`text-sm ${
                message.type === 'user'
                  ? 'text-foreground'
                  : 'text-muted-foreground font-mono'
              }`}>
                {message.content}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      {/* 输入框 */}
      <div className="flex-shrink-0 p-4">
        <div className="flex gap-2">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="输入指令..."
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim()}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}