# Error 组件使用指南

## ErrorBoundary

ErrorBoundary 组件用于捕获子组件树中的 JavaScript 错误，显示降级 UI 而不是崩溃整个应用。

### 基本使用

```tsx
import { ErrorBoundary } from '@/components/error';

function App() {
  return (
    <ErrorBoundary>
      <YourComponent />
    </ErrorBoundary>
  );
}
```

### 自定义降级 UI

```tsx
import { ErrorBoundary } from '@/components/error';

function App() {
  return (
    <ErrorBoundary 
      fallback={
        <div className="p-4 text-center">
          <h2>出错了</h2>
          <p>请刷新页面重试</p>
        </div>
      }
    >
      <YourComponent />
    </ErrorBoundary>
  );
}
```

### 错误处理回调

```tsx
import { ErrorBoundary } from '@/components/error';

function App() {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // 发送错误到监控服务
    console.error('Error caught:', error, errorInfo);
    // 可以调用错误追踪服务，如 Sentry
  };

  return (
    <ErrorBoundary onError={handleError}>
      <YourComponent />
    </ErrorBoundary>
  );
}
```

### 在页面级别使用

推荐在页面组件中使用 ErrorBoundary 包裹主要内容：

```tsx
// app/dashboard/page.tsx
import { ErrorBoundary } from '@/components/error';
import { DashboardClient } from './components/dashboard-client';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <h1>仪表盘</h1>
      <ErrorBoundary>
        <DashboardClient />
      </ErrorBoundary>
    </div>
  );
}
```

### 在关键组件中使用

对于可能出错的关键组件，可以单独包裹：

```tsx
import { ErrorBoundary } from '@/components/error';

function DashboardPage() {
  return (
    <div className="grid gap-4">
      <ErrorBoundary>
        <StatsSection />
      </ErrorBoundary>
      
      <ErrorBoundary>
        <ChartsSection />
      </ErrorBoundary>
      
      <ErrorBoundary>
        <ActivitySection />
      </ErrorBoundary>
    </div>
  );
}
```

## ErrorContent

ErrorContent 是默认的错误显示组件，提供友好的错误界面。

### 特性

- 显示错误 ID 和时间戳
- 提供刷新和返回首页按钮
- 支持复制错误 ID
- 国际化支持

### 直接使用

```tsx
import { ErrorContent } from '@/components/error';

function CustomErrorPage({ error }: { error: Error }) {
  const reset = () => {
    window.location.reload();
  };

  return <ErrorContent error={error} reset={reset} />;
}
```

## 最佳实践

1. **页面级别包裹**：在每个主要页面的根组件使用 ErrorBoundary
2. **关键功能隔离**：对可能出错的关键功能单独包裹，避免一个组件的错误影响整个页面
3. **错误上报**：使用 `onError` 回调将错误发送到监控服务
4. **自定义降级 UI**：根据业务需求提供合适的降级界面
5. **避免过度使用**：不要在每个小组件都包裹 ErrorBoundary，这会增加组件树的复杂度

## 注意事项

ErrorBoundary **无法**捕获以下错误：

- 事件处理器中的错误（使用 try-catch）
- 异步代码中的错误（使用 try-catch 或 Promise.catch）
- 服务端渲染的错误
- ErrorBoundary 自身的错误

对于这些情况，需要使用传统的错误处理方式。
