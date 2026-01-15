import * as React from "react"
import { Loader2, AlertCircle, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useIntersection } from "@/hooks/use-intersection"

interface InfiniteListProps {
  /**
   * 列表内容
   */
  children: React.ReactNode
  /**
   * 是否正在加载（包括初始加载和加载更多）
   */
  isLoading?: boolean
  /**
   * 是否发生错误
   */
  isError?: boolean
  /**
   * 是否还有更多数据
   */
  hasMore?: boolean
  /**
   * 加载更多回调
   */
  onLoadMore?: () => void
  /**
   * 当数据为空时显示的内容
   * 如果不传且 children 为空，会显示默认空状态
   */
  emptyDisplay?: React.ReactNode
  /**
   * 当发生错误时显示的内容
   */
  errorDisplay?: React.ReactNode
  /**
   * 加载时的指示器
   */
  loadingIndicator?: React.ReactNode
  /**
   * 容器类名，通常用于设置高度
   */
  className?: string
  /**
   * 是否使用 ScrollArea 组件包裹（如果为 false，则直接使用 div，适用于 body 滚动）
   * 默认为 true
   */
  useScrollArea?: boolean
}

export function InfiniteList({
  children,
  isLoading = false,
  isError = false,
  hasMore = false,
  onLoadMore,
  emptyDisplay,
  errorDisplay,
  loadingIndicator,
  className,
  useScrollArea = true,
}: InfiniteListProps) {
  const loaderRef = React.useRef<HTMLDivElement>(null)
  const isIntersecting = useIntersection(loaderRef, {
    threshold: 0.1,
    rootMargin: "100px", // 提前 100px 触发
  })

  // 触发加载更多
  React.useEffect(() => {
    if (isIntersecting && hasMore && !isLoading && !isError) {
      onLoadMore?.()
    }
  }, [isIntersecting, hasMore, isLoading, isError, onLoadMore])

  // 判断是否为空（这里简单判断 children 是否存在，更精确的控制应该由父组件通过 emptyDisplay 传入或自己控制）
  // 但为了通用性，如果 isLoading 为 false 且 children 看起来是空的（React.Children.count 为 0），显示空状态
  const isEmpty = !isLoading && !isError && React.Children.count(children) === 0

  const ContentWrapper = useScrollArea ? ScrollArea : "div"
  const wrapperProps = useScrollArea ? { className: cn("h-full", className) } : { className }

  return (
    <ContentWrapper {...wrapperProps}>
      <div className={cn("flex flex-col min-h-full", !useScrollArea && className)}>
        {/* 列表内容 */}
        {children}

        {/* 底部状态区域 */}
        <div className="flex flex-col items-center justify-center p-4 gap-2">
          {/* 触发器 (哨兵) */}
          {!isLoading && hasMore && !isError && (
             <div ref={loaderRef} className="h-4 w-full" />
          )}

          {/* 初始加载状态 (无数据且正在加载) */}
          {isLoading && React.Children.count(children) === 0 && (
             <div className="w-full space-y-4 px-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-[250px]" />
                      <Skeleton className="h-4 w-[200px]" />
                    </div>
                  </div>
                ))}
             </div>
          )}

          {/* 加载更多 Loading (有数据时) */}
          {isLoading && React.Children.count(children) > 0 && hasMore && (
            <div className="w-full flex justify-center py-2">
              {loadingIndicator || (
                 <div className="flex items-center gap-2 text-muted-foreground text-sm">
                   <Loader2 className="h-4 w-4 animate-spin" />
                   <span>加载中...</span>
                 </div>
              )}
            </div>
          )}

          {/* 错误状态 */}
          {isError && (
            <div className="w-full py-4 text-center">
              {errorDisplay || (
                <div className="flex flex-col items-center gap-2 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>加载失败</span>
                  </div>
                  {onLoadMore && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => onLoadMore()}
                    >
                      重试
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 空状态 (如果 children 为空且没在加载) */}
          {isEmpty && (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground">
              {emptyDisplay || (
                <>
                  <Inbox className="h-10 w-10 mb-2 opacity-50" />
                  <p>暂无数据</p>
                </>
              )}
            </div>
          )}
          
          {/* 没有更多数据提示 (可选，通常不用太显眼) */}
          {!hasMore && !isEmpty && !isLoading && !isError && (
            <div className="py-4 text-xs text-muted-foreground text-center opacity-50">
              - 没有更多了 -
            </div>
          )}
        </div>
      </div>
    </ContentWrapper>
  )
}
