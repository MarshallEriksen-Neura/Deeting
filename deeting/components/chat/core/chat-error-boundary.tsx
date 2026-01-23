"use client"

import * as React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/hooks/use-i18n"

interface ChatErrorBoundaryState {
  hasError: boolean
  error?: Error
}

interface ChatErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>
}

/**
 * ChatErrorBoundary 组件
 * 
 * 错误边界组件，用于捕获聊天组件树中的运行时错误。
 * 
 * 功能：
 * - 捕获子组件树中的 JavaScript 错误
 * - 记录错误信息到控制台
 * - 显示友好的错误 UI
 * - 提供重试和刷新功能
 * 
 * 注意：
 * - 必须使用类组件实现（React 错误边界的要求）
 * - 不会捕获事件处理器中的错误
 * - 不会捕获异步代码中的错误
 * - 不会捕获服务端渲染的错误
 * 
 * @param children - 子组件
 * @param fallback - 自定义错误展示组件（可选）
 * 
 * @example
 * ```tsx
 * <ChatErrorBoundary>
 *   <ChatContainer agentId="123" />
 * </ChatErrorBoundary>
 * ```
 */
export class ChatErrorBoundary extends React.Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  constructor(props: ChatErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    // 更新 state 使下一次渲染能够显示降级后的 UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 记录错误到控制台或错误监控服务
    console.error("Chat Error Boundary caught an error:", error, errorInfo)
    
    // 可以在这里添加错误上报逻辑
    // 例如：reportErrorToService(error, errorInfo)
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback
      return <FallbackComponent error={this.state.error} resetError={this.resetError} />
    }

    return this.props.children
  }
}

/**
 * DefaultErrorFallback 组件
 * 
 * 默认的错误展示组件，当错误边界捕获到错误时显示。
 * 
 * 功能：
 * - 显示友好的错误提示
 * - 显示错误详情（可展开）
 * - 提供重试按钮（重置错误边界）
 * - 提供刷新页面按钮
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 */
const DefaultErrorFallback = React.memo<{ error?: Error; resetError: () => void }>(
  function DefaultErrorFallback({ error, resetError }) {
    const t = useI18n("chat")

    // 使用 useCallback 缓存事件处理函数
    const handleRefresh = React.useCallback(() => {
      window.location.reload()
    }, [])

    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-lg">{t("error.title", { defaultValue: "出现错误" })}</CardTitle>
            <CardDescription>
              {t("error.description", { 
                defaultValue: "聊天组件遇到了一个错误，请尝试刷新页面。" 
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer font-medium">错误详情</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
                  {error.message}
                </pre>
              </details>
            )}
            <div className="flex gap-2">
              <Button onClick={resetError} className="flex-1">
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("error.retry", { defaultValue: "重试" })}
              </Button>
              <Button 
                variant="outline" 
                onClick={handleRefresh} 
                className="flex-1"
              >
                {t("error.refresh", { defaultValue: "刷新页面" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
)
