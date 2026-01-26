import { Clock, DollarSign, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export default function StatusBar() {
  return (
    <div className="h-12 px-4 flex items-center justify-between bg-card border-b border-border">
      {/* 左侧：项目信息 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">项目：</span>
          <span className="text-sm text-muted-foreground">京东手机采购</span>
        </div>
      </div>

      {/* 中间：进度和状态 */}
      <div className="flex items-center gap-6">
        {/* 预计剩余时间 */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>预计：2m 30s</span>
        </div>

        {/* Token消耗 */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <DollarSign className="w-4 h-4" />
          <span>$0.42/Token</span>
        </div>

        {/* 进度条 */}
        <div className="flex items-center gap-2">
          <Progress value={67} className="w-32" />
          <span className="text-xs text-muted-foreground">67%</span>
        </div>

        {/* 节点状态 */}
        <div className="text-sm text-muted-foreground">
          节点：3/12
        </div>
      </div>

      {/* 右侧：控制按钮 */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="default">
          <Play className="w-3 h-3" />
          实时
        </Button>
      </div>
    </div>
  )
}