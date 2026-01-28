# Chat Routing Components

此目录包含聊天路由相关的组件。

## 组件列表

### chat-route-client.tsx

**功能：** 聊天路由客户端组件

**职责：**
- 解析路由参数（agentId）
- 管理助手 ID 的优先级（路径 > 查询参数 > 存储）
- 渲染 ChatContainer

**性能优化：**
- 使用 `React.memo` 避免不必要的重渲染
- 使用 `useMemo` 缓存计算值（pathAgentId, queryAgentId）

**使用示例：**
```tsx
import { ChatRouteClientMemo } from '@/components/chat/routing/chat-route-client'

function ChatPage() {
  return <ChatRouteClientMemo />
}
```

**路由参数优先级：**
1. 路径参数：`/chat/[agentId]`
2. 查询参数：`/chat?agentId=xxx`
3. 存储状态：从 `useChatStateStore` 获取

**依赖：**
- `@/store/chat-state-store` - 聊天状态管理
- `@/components/chat/core` - 聊天容器

**迁移说明：**
- 原路径：`deeting/app/[locale]/chat/components/chat-route-client.tsx`
- 新路径：`deeting/components/chat/routing/chat-route-client.tsx`
- 迁移日期：2024
- 性能优化：添加了 React.memo、useMemo

**注意事项：**
- 这是一个路由解析组件，主要负责参数解析和传递
- 实际的业务逻辑在 ChatContainer 中处理
