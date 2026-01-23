# Chat Controller Components

此目录包含聊天控制器相关的组件（无 UI，纯逻辑）。

## 组件列表

### chat-controller.tsx

**功能：** 聊天控制器组件（无 UI）

**职责：**
- 管理聊天会话状态
- 同步云端和本地助手数据
- 加载历史消息
- 处理 Tauri 桌面端和 Web 端的差异
- 会话管理和 URL 同步
- 模型配置同步

**性能优化：**
- 使用 `React.memo` 避免不必要的重渲染
- 使用 `useMemo` 缓存计算值（isTauriRuntime, localAgent, agent, sessionStorageKey, greeting）
- 优化了多个 useEffect 的依赖项

**使用示例：**
```tsx
import { ChatControllerMemo } from '@/components/chat/controller/chat-controller'

function ChatPage({ agentId }: { agentId: string }) {
  return (
    <>
      <ChatControllerMemo agentId={agentId} />
      {/* 其他 UI 组件 */}
    </>
  )
}
```

**Props：**
- `agentId: string` - 助手 ID

**依赖：**
- `@/store/chat-store` - 聊天状态管理
- `@/store/market-store` - 市场/助手数据
- `@/hooks/use-chat-service` - 聊天服务 Hook
- `@/hooks/use-i18n` - 国际化
- `@tauri-apps/api/core` - Tauri API（桌面端）

**迁移说明：**
- 原路径：`deeting/app/[locale]/chat/components/chat-controller.tsx`
- 新路径：`deeting/components/chat/controller/chat-controller.tsx`
- 迁移日期：2024
- 性能优化：添加了 React.memo、useMemo 缓存计算值

**注意事项：**
- 这是一个无 UI 的控制器组件，返回 `null`
- 通过 side effects 管理状态和数据同步
- 支持 Tauri 桌面端和 Web 端两种环境
