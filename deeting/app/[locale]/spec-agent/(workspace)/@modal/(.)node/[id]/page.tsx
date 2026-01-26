'use client'

import { useRouter } from 'next/navigation'
import { Eye, Play, SkipForward } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface NodeDetailModalProps {
  params: {
    id: string
  }
}

export default function NodeDetailModal({ params }: NodeDetailModalProps) {
  const router = useRouter()

  const handleClose = () => {
    router.back()
  }

  // 模拟节点数据
  const nodeData = {
    id: params.id,
    title: '商品搜索',
    type: 'action',
    status: 'active',
    input: { keyword: 'iPhone 15 Pro 256G' },
    output: {
      results: [
        { name: 'iPhone 15 Pro', price: 7999, stock: 5 },
        { name: 'iPhone 15 Pro Max', price: 8999, stock: 0 }
      ]
    },
    duration: '3.2s',
    logs: [
      '正在连接京东API...',
      '已获取商品列表 (12项)',
      '正在筛选32G版本...',
      '发现2个匹配结果'
    ]
  }

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>节点详情: {nodeData.id}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-96">
          <div className="space-y-4 pr-4">
            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">节点类型</label>
                <p className="text-sm text-foreground">{nodeData.type === 'action' ? '执行节点' : '逻辑网关'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">执行状态</label>
                <p className="text-sm text-foreground capitalize">{nodeData.status}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">执行时间</label>
                <p className="text-sm text-foreground">{nodeData.duration}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">节点标题</label>
                <p className="text-sm text-foreground">{nodeData.title}</p>
              </div>
            </div>

            <Separator />

            {/* Input/Output */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">输入参数</label>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto font-mono">
                  {JSON.stringify(nodeData.input, null, 2)}
                </pre>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">输出结果</label>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto font-mono">
                  {JSON.stringify(nodeData.output, null, 2)}
                </pre>
              </div>
            </div>

            <Separator />

            {/* 执行日志 */}
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">执行日志</label>
              <div className="space-y-1">
                {nodeData.logs.map((log, index) => (
                  <div key={index} className="text-xs text-muted-foreground font-mono bg-muted/50 px-3 py-2 rounded">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm">
            <Eye className="w-4 h-4 mr-2" />
            查看原始日志
          </Button>
          <Button size="sm">
            <Play className="w-4 h-4 mr-2" />
            重试
          </Button>
          <Button variant="outline" size="sm">
            <SkipForward className="w-4 h-4 mr-2" />
            跳过
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}