# Chat Console Components

此目录包含聊天控制台相关的组件。

## 组件列表

### controls-container.tsx

**功能：** 聊天控制面板组件

**职责：**
- 消息输入和发送
- 附件管理（图片上传、预览、删除）
- 参数配置（temperature, topP）
- 助手选择
- 新建会话
- 模式切换（聊天/图像/代码）

**性能优化：**
- 使用 `React.memo` 避免不必要的重渲染
- 使用 `useCallback` 缓存事件处理函数
- 使用 `useMemo` 缓存计算值（canSend, activeAssistant, attachmentGridClassName）

**使用示例：**
```tsx
import ControlsContainer from '@/components/chat/console/controls-container'

function ChatPage() {
  return (
    <div>
      <ControlsContainer />
    </div>
  )
}
```

**依赖：**
- `@/store/chat-state-store` - 聊天状态管理
- `@/store/chat-session-store` - 会话状态管理
- `@/store/market-store` - 市场/助手数据
- `@/hooks/use-i18n` - 国际化
- `@/lib/chat/attachments` - 附件处理
- `@/hooks/chat/use-chat-messaging` - 消息发送与取消

**迁移说明：**
- 原路径：`deeting/app/[locale]/chat/components/controls-container.tsx`
- 新路径：`deeting/components/chat/console/controls-container.tsx`
- 迁移日期：2024
- 性能优化：添加了 React.memo、useCallback、useMemo

## 相关组件

- `coder-console.tsx` - 代码编辑控制台
- `floating-console.tsx` - 浮动控制台
- `floating-control-center.tsx` - 浮动控制中心
