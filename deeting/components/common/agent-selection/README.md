# Agent Selection Components

助手选择组件目录，包含助手选择和创建相关的组件。

## 组件列表

### SelectAgentContainer (select-agent-container.tsx)

助手选择容器组件，显示可用的助手列表并允许用户选择或创建助手。

**功能：**
- 显示已安装的助手（Tauri 模式）或云端助手（Web 模式）
- 支持创建新助手
- 支持编辑已有助手（如果用户是所有者）
- 全屏模态框显示
- 背景模糊效果

**性能优化：**
- 使用 `React.useMemo` 缓存助手映射和云端助手列表
- 使用 `React.useCallback` 缓存事件处理函数
- AgentCard 组件使用 `React.memo` 避免不必要的重渲染

**使用示例：**

```tsx
import { SelectAgentContainer } from '@/components/common/agent-selection'

// 在路由 /chat/select 中使用
export default function SelectAgentPage() {
  return <SelectAgentContainer />
}
```

### CreateAssistantSlot (create-assistant-slot.tsx)

创建助手槽位组件，用于在路由 `/chat/create/assistant` 时显示创建助手的模态框。

**功能：**
- 自动打开创建助手模态框
- 创建成功后跳转到新助手的聊天页面
- 关闭模态框后返回聊天首页
- 支持 Tauri 和 Web 模式

**性能优化：**
- 使用 `useCallback` 缓存事件处理函数

**使用示例：**

```tsx
import { CreateAssistantSlot } from '@/components/common/agent-selection'

// 在路由 /chat/create/assistant 中使用
export default function CreateAssistantPage() {
  return <CreateAssistantSlot />
}
```

## 子组件

### AgentCard

助手卡片组件，显示单个助手的信息。

**Props：**

```typescript
interface AgentCardProps {
  icon: React.ReactNode      // 图标
  name: string               // 助手名称
  desc: string               // 助手描述
  onClick?: () => void       // 点击事件
  action?: React.ReactNode   // 操作按钮（如编辑）
}
```

**特性：**
- 支持键盘导航（Enter/Space）
- Hover 效果和动画
- 可选的操作按钮

## 依赖

- `@/store/market-store` - 市场状态管理
- `@/hooks/use-chat-service` - 聊天服务 Hook
- `@/hooks/use-user` - 用户信息 Hook
- `@/components/assistants/create-agent-modal` - 创建助手模态框
- `next-intl` - 国际化

## 迁移说明

这些组件已从 `app/[locale]/chat/components/` 迁移至此。

**迁移日期：** 2024

**变更：**
- 添加了性能优化（useMemo、useCallback、React.memo）
- 添加了详细的 TypeScript 类型定义
- 添加了详细的 JSDoc 注释
- AgentCard 提取为独立的 memo 组件

**向后兼容：**
原路径仍然可用，通过重导出保持兼容性。

## 国际化

组件使用 `next-intl` 进行国际化，需要在 `messages` 中定义以下 key：

```typescript
{
  "assistants": {
    "select": {
      "title": "选择助手",
      "subtitle": "选择一个助手开始对话",
      "create": {
        "name": "创建新助手",
        "desc": "创建一个自定义助手"
      }
    },
    "edit": {
      "trigger": "编辑助手"
    }
  }
}
```
