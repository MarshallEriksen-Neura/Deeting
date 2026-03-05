/**
 * 通用的 Admin 页面动态加载骨架
 * 不使用任何 hooks，兼容 server component 和 dynamic() loading 选项
 */
export function PageLoading() {
  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#05050A] p-6 space-y-5">
      {/* 标题区域 */}
      <div className="space-y-2">
        <div className="h-7 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
      </div>

      {/* 统计卡片骨架 */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-24 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl animate-pulse"
          />
        ))}
      </div>

      {/* 主体内容骨架 */}
      <div className="flex-1 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl animate-pulse min-h-[300px]" />
    </div>
  )
}
