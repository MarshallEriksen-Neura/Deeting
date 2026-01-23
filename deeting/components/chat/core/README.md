# Chat Core 模块

## 概述

此模块提供聊天功能的核心层，包括：
- **Context 层**：作为 Zustand store 的包装层，提供依赖注入和组件间通信能力
- **容器组件**：ChatContainer 负责数据获取、路由管理和生命周期控制

## 架构设计

### 模块组成

```
Chat Core 模块
├── ChatContainer          - 容器组件（数据获取、路由管理）
├── ChatLayout             - 布局组件（整体布局结构）
├── ChatErrorBoundary      - 错误边界（错误捕获和展示）
└── Context 层
    ├── ChatMessagesContext    - 消息数据
    ├── ChatUIStateContext      - UI 状态
    └── ChatConfigContext       - 配置和会话状态
```

### Context 拆分

为了优化性能和提高可维护性，我们将聊天 Context 拆分为三个独立的部分：

```
ChatProvider (组合)
├── ChatMessagesContext    - 消息数据
├── ChatUIStateContext      - UI 状态
└── ChatConfigContext       - 配置和会话状态
```

### 为什么要拆分？

1. **减少重渲染**：组件只订阅需要的 Context，避免不必要的重渲染
2. **职责分离**：每个 Context 有明确的职责范围
3. **性能优化**：每个 Context 独立缓存，使用 `useMemo` 优化
4. **更好的类型安全**：每个 Context 有独立的类型定义

## 使用指南

### ChatContainer - 容器组件

ChatContainer 是聊天功能的顶层容器，负责：
- 数据获取（通过 SWR Hooks）
- 环境检测（Tauri/Web）
- 路由管理和导航
- 会话生命周期控制

```tsx
import { ChatContainer } from "@/components/chat/core"

function ChatPage({ params }: { params: { agentId: string } }) {
  return <ChatContainer agentId={params.agentId} />
}
```

**特性：**
- ✅ 使用 `useCallback` 缓存事件处理函数
- ✅ 使用 `useMemo` 缓存计算结果
- ✅ 通过 SWR Hooks 获取数据（不直接使用 fetch）
- ✅ 自动处理云端/本地数据源切换
- ✅ 内置错误边界保护

**性能优化：**
```tsx
// 环境检测结果被缓存
const isTauriRuntime = React.useMemo(() => {
  return process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
}, [])

// 事件处理函数被缓存
const handleNewChat = React.useCallback(() => {
  // ...
}, [dependencies])

// Props 对象被缓存，减少子组件重渲染
const chatContentProps = React.useMemo(() => ({
  agent,
  cloudModels,
  // ...
}), [agent, cloudModels, ...])
```

### ChatLayout - 布局组件

ChatLayout 负责聊天界面的整体布局结构，包括：
- 加载状态展示
- 错误状态展示（代理不存在）
- 正常聊天布局容器

```tsx
import { ChatLayout } from "@/components/chat/core"

function ChatPage() {
  const { agent, isLoading } = useChatAgent(agentId)
  
  return (
    <ChatLayout agent={agent} isLoadingAssistants={isLoading}>
      <ChatContent />
    </ChatLayout>
  )
}
```

**特性：**
- ✅ 使用 `React.memo` 避免不必要的重渲染
- ✅ 使用 `useCallback` 缓存事件处理函数
- ✅ 自动处理加载和错误状态
- ✅ 使用 shadcn/ui 组件保持样式一致
- ✅ 支持国际化（i18n）

**Props 接口：**
```typescript
interface ChatLayoutProps {
  children: React.ReactNode        // 聊天内容
  agent?: ChatAssistant            // 当前代理
  isLoadingAssistants?: boolean    // 是否正在加载
}
```

**性能优化：**
```tsx
// 使用 React.memo 包装，只在 props 变化时重渲染
export const ChatLayout = React.memo<ChatLayoutProps>(
  function ChatLayout({ children, agent, isLoadingAssistants }) {
    // 缓存事件处理函数
    const handleBackToList = React.useCallback(() => {
      router.push("/chat")
    }, [router])
    
    // ...
  }
)
```

### ChatErrorBoundary - 错误边界

ChatErrorBoundary 用于捕获聊天组件树中的运行时错误，提供友好的错误展示和恢复机制。

```tsx
import { ChatErrorBoundary } from "@/components/chat/core"

function ChatPage() {
  return (
    <ChatErrorBoundary>
      <ChatContainer agentId={agentId} />
    </ChatErrorBoundary>
  )
}
```

**特性：**
- ✅ 捕获子组件树中的 JavaScript 错误
- ✅ 记录错误信息到控制台
- ✅ 显示友好的错误 UI
- ✅ 提供重试和刷新功能
- ✅ 支持自定义错误展示组件
- ✅ DefaultErrorFallback 使用 `React.memo` 优化

**Props 接口：**
```typescript
interface ChatErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ 
    error?: Error
    resetError: () => void 
  }>
}
```

**使用自定义 Fallback：**
```tsx
function CustomErrorFallback({ error, resetError }) {
  return (
    <div>
      <h1>出错了！</h1>
      <p>{error?.message}</p>
      <button onClick={resetError}>重试</button>
    </div>
  )
}

<ChatErrorBoundary fallback={CustomErrorFallback}>
  <ChatContainer agentId={agentId} />
</ChatErrorBoundary>
```

**注意事项：**

错误边界**不会**捕获以下错误：
- 事件处理器中的错误（使用 try-catch）
- 异步代码中的错误（如 setTimeout、Promise）
- 服务端渲染的错误
- 错误边界自身的错误

**错误处理最佳实践：**
```tsx
// ✅ 好 - 错误边界会捕获
function MyComponent() {
  if (someCondition) {
    throw new Error("Something went wrong")
  }
  return <div>Content</div>
}

// ❌ 不好 - 错误边界不会捕获
function MyComponent() {
  const handleClick = () => {
    throw new Error("Click error")  // 需要 try-catch
  }
  return <button onClick={handleClick}>Click</button>
}

// ✅ 好 - 事件处理器中使用 try-catch
function MyComponent() {
  const handleClick = () => {
    try {
      // 可能出错的代码
    } catch (error) {
      console.error(error)
      // 显示错误提示
    }
  }
  return <button onClick={handleClick}>Click</button>
}
```

### 基本使用

```tsx
import { ChatProvider } from "@/components/chat/core"

function ChatPage() {
  return (
    <ChatProvider>
      <ChatLayout>
        <MessageList />
        <ChatInput />
      </ChatLayout>
    </ChatProvider>
  )
}
```

### 使用消息数据

```tsx
import { useChatMessages } from "@/components/chat/core"

function MessageList() {
  const { messages, isTyping } = useChatMessages()
  
  return (
    <div>
      {messages.map(msg => (
        <Message key={msg.id} {...msg} />
      ))}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
```

### 使用 UI 状态

```tsx
import { useChatUIState } from "@/components/chat/core"

function ChatInput() {
  const { 
    input, 
    setInput, 
    attachments, 
    addAttachments,
    removeAttachment 
  } = useChatUIState()
  
  return (
    <div>
      <input 
        value={input} 
        onChange={e => setInput(e.target.value)} 
      />
      <AttachmentList 
        attachments={attachments}
        onRemove={removeAttachment}
      />
    </div>
  )
}
```

### 使用配置和状态

```tsx
import { useChatConfig } from "@/components/chat/core"

function ChatSettings() {
  const { streamEnabled, setStreamEnabled } = useChatConfig()
  
  return (
    <label>
      <input
        type="checkbox"
        checked={streamEnabled}
        onChange={e => setStreamEnabled(e.target.checked)}
      />
      启用流式传输
    </label>
  )
}

function ErrorDisplay() {
  const { errorMessage, setErrorMessage } = useChatConfig()
  
  if (!errorMessage) return null
  
  return (
    <div className="error">
      {errorMessage}
      <button onClick={() => setErrorMessage(null)}>关闭</button>
    </div>
  )
}
```

## API 参考

### ChatMessagesContext

管理聊天消息数据。

```typescript
interface ChatMessagesContextValue {
  messages: Message[]              // 消息列表
  isTyping: boolean                // 是否正在输入/加载
  addMessage: (role, content, attachments?) => void  // 添加消息
  updateMessage: (id, content) => void               // 更新消息
  clearMessages: () => void                          // 清空消息
}
```

**使用场景：**
- 消息列表组件
- 需要添加或更新消息
- 需要检查加载状态

### ChatUIStateContext

管理聊天界面的 UI 状态。

```typescript
interface ChatUIStateContextValue {
  input: string                    // 输入框内容
  setInput: (input: string) => void  // 设置输入
  attachments: ChatImageAttachment[]  // 附件列表
  addAttachments: (attachments) => void  // 添加附件
  removeAttachment: (id) => void         // 移除附件
  clearAttachments: () => void           // 清空附件
}
```

**使用场景：**
- 输入框组件
- 附件上传和管理
- 需要清空输入状态

### ChatConfigContext

管理聊天配置和会话状态。

```typescript
interface ChatConfigContextValue {
  streamEnabled: boolean           // 流式传输开关
  setStreamEnabled: (enabled) => void  // 设置流式传输
  errorMessage: string | null      // 错误消息
  setErrorMessage: (error) => void  // 设置错误
  statusStage: string | null       // 状态阶段
  statusCode: string | null        // 状态码
  statusMeta: Record<string, unknown> | null  // 状态元数据
  resetSession: () => void         // 重置会话
}
```

**使用场景：**
- 设置面板
- 错误提示组件
- 状态指示器
- 会话重置

## 向后兼容

为了保持向后兼容，原来的文件已更新为重导出新实现。

### ChatContainer 向后兼容

```tsx
// 旧路径（仍然可用，但不推荐）
import { ChatContainer } from "@/app/[locale]/chat/components/chat-container"

// 新路径（推荐）
import { ChatContainer } from "@/components/chat/core"
```

### ChatLayout 向后兼容

```tsx
// 旧路径（仍然可用，但不推荐）
import { ChatLayout } from "@/app/[locale]/chat/components/chat-layout"

// 新路径（推荐）
import { ChatLayout } from "@/components/chat/core"
```

### ChatErrorBoundary 向后兼容

```tsx
// 旧路径（仍然可用，但不推荐）
import { ChatErrorBoundary } from "@/app/[locale]/chat/components/chat-error-boundary"

// 新路径（推荐）
import { ChatErrorBoundary } from "@/components/chat/core"
```

### ChatProvider 向后兼容

### 旧的使用方式（仍然支持）

```tsx
import { useChatContext } from "@/app/[locale]/chat/components/chat-provider"

function MyComponent() {
  const { input, setInput, isTyping } = useChatContext()
  // ...
}
```

### 推荐的新方式

```tsx
import { useChatUIState, useChatMessages } from "@/components/chat/core"

function MyComponent() {
  const { input, setInput } = useChatUIState()
  const { isTyping } = useChatMessages()
  // ...
}
```

**优势：**
- 更好的性能（只订阅需要的状态）
- 更清晰的依赖关系
- 更好的类型提示

## 迁移指南

### 步骤 1：更新导入

```tsx
// 旧
import { useChatContext } from "@/app/[locale]/chat/components/chat-provider"

// 新
import { 
  useChatMessages, 
  useChatUIState, 
  useChatConfig 
} from "@/components/chat/core"
```

### 步骤 2：拆分 Hook 调用

```tsx
// 旧
function MyComponent() {
  const { 
    input, 
    setInput, 
    isTyping, 
    errorMessage 
  } = useChatContext()
}

// 新
function MyComponent() {
  const { input, setInput } = useChatUIState()
  const { isTyping } = useChatMessages()
  const { errorMessage } = useChatConfig()
}
```

### 步骤 3：测试

确保组件行为与之前一致，特别注意：
- 状态更新是否正常
- 重渲染次数是否减少
- 类型检查是否通过

## 性能优化

### 使用 React.memo

对于只使用特定 Context 的组件，使用 `React.memo` 可以进一步优化：

```tsx
import { memo } from "react"
import { useChatMessages } from "@/components/chat/core"

export const MessageList = memo(function MessageList() {
  const { messages } = useChatMessages()
  // 只在 messages 变化时重渲染
  return <div>{/* ... */}</div>
})
```

### 避免不必要的订阅

只订阅需要的 Context：

```tsx
// ❌ 不好 - 订阅了不需要的状态
function MyButton() {
  const { input, setInput } = useChatUIState()  // 不需要 input
  return <button onClick={() => setInput("")}>清空</button>
}

// ✅ 好 - 只获取需要的函数
function MyButton() {
  const { setInput } = useChatUIState()
  return <button onClick={() => setInput("")}>清空</button>
}
```

## 与 Zustand Store 的关系

Context 层是 Zustand store 的包装：

```
组件 → Context (useChatMessages) → Zustand Store (useChatStateStore)
```

**为什么需要 Context 层？**

1. **依赖注入**：方便测试和模拟
2. **跨组件通信**：不需要 prop drilling
3. **统一接口**：隐藏 store 实现细节
4. **性能优化**：通过拆分减少重渲染

## 测试

### 测试组件

```tsx
import { render } from "@testing-library/react"
import { ChatProvider } from "@/components/chat/core"

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <ChatProvider>
      {ui}
    </ChatProvider>
  )
}

test("should display messages", () => {
  const { getByText } = renderWithProvider(<MessageList />)
  // ...
})
```

### Mock Context

```tsx
import { ChatMessagesContext } from "@/components/chat/core/chat-messages-context"

const mockContextValue = {
  messages: [],
  isTyping: false,
  addMessage: jest.fn(),
  updateMessage: jest.fn(),
  clearMessages: jest.fn(),
}

test("with mocked context", () => {
  render(
    <ChatMessagesContext.Provider value={mockContextValue}>
      <MyComponent />
    </ChatMessagesContext.Provider>
  )
})
```

## 常见问题

### Q: 为什么不直接使用 Zustand store？

A: Context 层提供了额外的好处：
- 依赖注入能力（方便测试）
- 统一的接口（隐藏实现细节）
- 更好的组件隔离

### Q: 拆分后性能真的会更好吗？

A: 是的。组件只订阅需要的 Context，避免了不必要的重渲染。例如：
- 只显示消息的组件不会因为输入框内容变化而重渲染
- 只管理输入的组件不会因为消息更新而重渲染

### Q: 我应该使用旧的 useChatContext 还是新的拆分 Hooks？

A: 推荐使用新的拆分 Hooks。旧的 API 仅为向后兼容保留，新代码应使用拆分的 Hooks。

### Q: 如何决定使用哪个 Context？

A: 根据组件的职责：
- 显示/操作消息 → `useChatMessages`
- 管理输入/附件 → `useChatUIState`
- 配置/错误/状态 → `useChatConfig`

## 相关文件

### 核心组件
- `chat-container.tsx` - 容器组件（数据获取、路由管理）

### Context 层
- `chat-messages-context.tsx` - 消息数据 Context
- `chat-ui-state-context.tsx` - UI 状态 Context
- `chat-config-context.tsx` - 配置 Context
- `chat-provider.tsx` - 组合 Provider

### 导出和文档
- `index.ts` - 导出文件
- `README.md` - 使用文档
- `MIGRATION.md` - 迁移指南

### Store 层
- `@/store/chat-state-store.ts` - 状态 Store
- `@/store/chat-session-store.ts` - 会话 Store

### Hooks
- `@/hooks/use-chat-service.ts` - 云端服务（SWR）
- `@/hooks/chat/use-chat-agent.ts` - 代理管理
- `@/hooks/chat/use-chat-session.ts` - 会话管理
- `@/hooks/chat/use-chat-history.ts` - 历史记录管理

## 更新日志

### 2024 - 任务 13.4
- ✅ 迁移 ChatLayout 到 `components/chat/core/`
- ✅ 迁移 ChatErrorBoundary 到 `components/chat/core/`
- ✅ ChatLayout 使用 React.memo 优化
- ✅ ChatLayout 使用 useCallback 缓存事件处理函数
- ✅ ChatErrorBoundary 保持类组件实现
- ✅ DefaultErrorFallback 使用 React.memo 优化
- ✅ 创建向后兼容的重导出文件
- ✅ 添加完整的 JSDoc 文档
- ✅ 更新 ChatContainer 的导入路径

### 2024 - 任务 13.3
- ✅ 迁移 ChatContainer 到 `components/chat/core/`
- ✅ 使用 useCallback 缓存事件处理函数
- ✅ 使用 useMemo 缓存计算结果和 props
- ✅ 确保使用 SWR Hooks 获取数据
- ✅ 创建向后兼容的重导出文件
- ✅ 添加完整的 JSDoc 文档

### 2024 - 任务 13.1
- ✅ 创建三个独立的 Context
- ✅ 使用 useMemo 缓存 Context 值
- ✅ 保持向后兼容的 API
- ✅ 添加完整的文档和示例
