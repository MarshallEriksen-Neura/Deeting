import { notFound } from 'next/navigation'

// 直接访问节点详情页（非模态框形式）
// 当用户直接访问 /spec-agent/node/123 时显示完整页面
export default function NodeDetailPage({ params }: { params: { id: string } }) {
  // 这里可以添加节点数据验证逻辑
  // 如果节点不存在，返回 404
  // if (!nodeExists(params.id)) {
  //   notFound()
  // }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-foreground mb-6">
            节点详情: {params.id}
          </h1>

          {/* 这里可以复用模态框的内容组件 */}
          <div className="bg-card rounded-lg p-6">
            <p className="text-muted-foreground">
              节点详情内容（与模态框相同，但作为独立页面）
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}