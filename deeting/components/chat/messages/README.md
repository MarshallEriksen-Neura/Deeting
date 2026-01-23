# Chat Messages 模块

消息展示相关组件，负责聊天消息的渲染和展示。

## 组件列表

### ChatMessageList

消息列表展示组件，支持虚拟滚动优化大列表性能。

**功能特性：**
- ✅ 当消息数量 > 50 时自动启用虚拟滚动（react-virtuoso）
- ✅ 当消息数量 <= 50 时使用普通滚动（ScrollArea）
- ✅ 自动滚动到底部（新消息到达时）
- ✅ 滚动位置保持（用户向上滚动查看历史时）
- ✅ 使用 MessageItem 组件渲染单条消息
- ✅ 支持滚动到顶部/底部按钮
- ✅ 支持正在输入指示器

**Props 接口：**

```typescript
interface ChatMessageListProps {
  messages: Message[]                       // 消息列表
  agent: ChatAssistant                      // 助手信息
  isTyping: boolean                         // 是否正在输入
  streamEnabled: boolean                    // 是否启用流式响应
  statusStage: string | null                // 状态阶段
  statusCode: string | null                 // 状态码
  statusMeta: Record<string, unknown> | null // 状态元数据
}
```

**使用示例：**

```tsx
import { ChatMessageList } from "@/components/chat/messages"

function ChatContent({ agent }) {
  const messages = useChatMessages()
  const { isTyping, streamEnabled, statusStage, statusCode, statusMeta } = useChatState()

  return (
    <ChatMessageList
      messages={messages}
      agent={agent}
      isTyping={isTyping}
      streamEnabled={streamEnabled}
      statusStage={statusStage}
      statusCode={statusCode}
      statusMeta={statusMeta}
    />
  )
}
```

**性能优化：**

1. **虚拟滚动**：当消息数量超过 50 条时，自动启用虚拟滚动，只渲染可见区域的消息，大幅提升大列表性能。
2. **条件渲染**：根据消息数量动态选择渲染模式（虚拟滚动 vs 普通滚动）。
3. **回调缓存**：使用 useCallback 缓存滚动和渲染函数，避免不必要的重新创建。
4. **组件复用**：使用 MessageItem 组件渲染单条消息，利用其 memo 优化。

**滚动行为：**

- **自动滚动**：当用户在底部时，新消息到达会自动滚动到底部
- **位置保持**：当用户向上滚动查看历史时，新消息到达不会打断阅读
- **手动控制**：提供滚动到顶部/底部按钮，方便快速导航

**虚拟滚动实现：**

使用 react-virtuoso 库实现虚拟滚动：
- `followOutput="smooth"`：平滑跟随新内容
- `alignToBottom`：对齐到底部
- `rangeChanged`：监听可见范围变化，更新滚动按钮状态
- 自定义 List 和 Footer 组件，保持样式一致性

**组件结构：**

```
ChatMessageList
├── 虚拟滚动模式（消息数量 > 50）
│   ├── Virtuoso
│   │   ├── List (消息容器)
│   │   │   └── MessageItem × N (只渲染可见消息)
│   │   └── Footer (正在输入指示器)
│   └── 滚动按钮
│       ├── 滚动到顶部
│       └── 滚动到底部
└── 普通滚动模式（消息数量 <= 50）
    ├── ScrollArea
    │   ├── MessageItem × N (渲染所有消息)
    │   └── 正在输入指示器
    └── 滚动按钮
        ├── 滚动到顶部
        └── 滚动到底部
```

### MessageItem

单条消息展示组件，使用 React.memo 优化性能。

**功能特性：**
- ✅ 支持用户消息和助手消息的不同展示样式
- ✅ 支持附件预览（图片）
- ✅ 支持时间戳显示
- ✅ 使用 React.memo 避免不必要的重渲染
- ✅ 自定义比较函数优化性能
- ✅ 支持流式响应状态显示
- ✅ 支持思维链和工具调用展示

**Props 接口：**

```typescript
interface MessageItemProps {
  message: Message                          // 消息对象
  agent: ChatAssistant                      // 助手信息
  isActive?: boolean                        // 是否为当前活跃消息
  streamEnabled?: boolean                   // 是否启用流式响应
  statusStage?: string | null               // 状态阶段
  statusCode?: string | null                // 状态码
  statusMeta?: Record<string, unknown> | null // 状态元数据
  lastAssistantId?: string                  // 最后一条助手消息 ID
  isTyping?: boolean                        // 是否正在输入
}
```

**使用示例：**

```tsx
import { MessageItem } from "@/components/chat/messages"

function ChatMessageList({ messages, agent, isTyping }) {
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]?.id
    }
    return undefined
  }, [messages])

  return (
    <div className="space-y-6">
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          agent={agent}
          isActive={msg.id === lastAssistantId && isTyping}
          streamEnabled={streamEnabled}
          statusStage={msg.id === lastAssistantId ? statusStage : null}
          statusCode={msg.id === lastAssistantId ? statusCode : null}
          statusMeta={msg.id === lastAssistantId ? statusMeta : null}
          lastAssistantId={lastAssistantId}
          isTyping={isTyping}
        />
      ))}
    </div>
  )
}
```

**性能优化：**

MessageItem 使用自定义比较函数，只在以下情况重渲染：
- 消息 ID 或内容变化
- 附件变化
- 激活状态变化
- 状态信息变化（仅在激活时）
- 流式配置变化
- 助手信息变化
- lastAssistantId 变化
- isTyping 变化

**组件结构：**

```
MessageItem
├── Avatar (头像)
│   ├── 助手：使用 dicebear 生成的头像
│   └── 用户：使用 User 图标
└── Message Bubble (消息气泡)
    ├── 助手消息
    │   ├── AIResponseBubble (AI 响应气泡)
    │   ├── MessageAttachments (附件)
    │   └── Timestamp (时间戳)
    └── 用户消息
        ├── MessageAttachments (附件)
        ├── MarkdownViewer (Markdown 内容)
        └── Timestamp (时间戳)
```

### MessageAttachments

消息附件展示组件，使用 React.memo 优化。

**功能特性：**
- ✅ 支持图片网格布局（2 列或 3 列）
- ✅ 支持用户消息和助手消息的不同样式
- ✅ 使用 ImageLightbox 支持图片放大查看
- ✅ 悬停时图片缩放效果
- ✅ 显示图片名称

**Props 接口：**

```typescript
interface MessageAttachmentsProps {
  attachments: ChatImageAttachment[]  // 附件列表
  variant?: "assistant" | "user"      // 样式变体
  alt: string                         // 图片 alt 文本
}
```

## 依赖关系

```
ChatMessageList
├── @/components/ui/scroll-area (shadcn/ui)
├── @/components/ui/button (shadcn/ui)
├── @/components/ui/avatar (shadcn/ui)
├── @/components/chat/messages/message-item
├── @/app/[locale]/chat/components/ai-response-bubble
├── @/store/chat-store
├── @/hooks/use-i18n
└── react-virtuoso (虚拟滚动库)

MessageItem
├── @/components/ui/avatar (shadcn/ui)
├── @/components/ui/image-lightbox
├── @/components/chat/markdown-viewer
├── @/app/[locale]/chat/components/ai-response-bubble
├── @/lib/chat/message-normalizer
├── @/lib/chat/message-content
├── @/store/chat-store
└── @/hooks/use-i18n
```

## 文件大小

- `chat-message-list.tsx`: ~280 行（符合 < 300 行的要求）
- `message-item.tsx`: ~250 行（符合 < 300 行的要求）

## 测试覆盖

待实现：
- [ ] 单元测试：不同角色消息的渲染
- [ ] 单元测试：memo 优化效果
- [ ] 单元测试：附件显示
- [ ] 性能测试：重渲染次数验证
- [ ] 单元测试：虚拟滚动启用条件（消息数量 > 50）
- [ ] 单元测试：自动滚动到底部行为
- [ ] 单元测试：滚动位置保持
- [ ] 性能测试：大列表渲染性能（1000+ 消息）
- [ ] 集成测试：滚动按钮交互

## 迁移指南

### 从旧的 chat-message-list.tsx 迁移

**之前（旧实现）：**
```tsx
// 在 chat-message-list.tsx 中直接渲染所有消息
// 无虚拟滚动，大列表性能差
import { ChatMessageList } from "@/app/[locale]/chat/components/chat-message-list"

<ChatMessageList
  messages={messages}
  agent={agent}
  isTyping={isTyping}
  streamEnabled={streamEnabled}
  statusStage={statusStage}
  statusCode={statusCode}
  statusMeta={statusMeta}
/>
```

**之后（新实现）：**
```tsx
// 使用新的 ChatMessageList，自动启用虚拟滚动
// 使用 MessageItem 组件，性能优化
import { ChatMessageList } from "@/components/chat/messages"

<ChatMessageList
  messages={messages}
  agent={agent}
  isTyping={isTyping}
  streamEnabled={streamEnabled}
  statusStage={statusStage}
  statusCode={statusCode}
  statusMeta={statusMeta}
/>
```

**主要变化：**

1. **导入路径变更**：
   - 旧：`@/app/[locale]/chat/components/chat-message-list`
   - 新：`@/components/chat/messages`（推荐）
   - 兼容：旧路径仍可用，但已标记为 deprecated

2. **虚拟滚动**：
   - 消息数量 > 50 时自动启用虚拟滚动
   - 消息数量 <= 50 时使用普通滚动
   - 无需手动配置，自动优化

3. **组件拆分**：
   - 单条消息渲染逻辑提取到 MessageItem 组件
   - 附件渲染逻辑提取到 MessageAttachments 组件
   - 更好的代码组织和性能优化

4. **Props 接口**：
   - 保持完全兼容，无需修改调用代码
   - 内部实现优化，外部 API 不变

### 从内联消息渲染迁移到 MessageItem

**之前：**
```tsx
{messages.map((msg) => (
  <div key={msg.id} className="flex gap-3">
    {/* 大量内联渲染逻辑 */}
  </div>
))}
```

**之后：**
```tsx
import { MessageItem } from "@/components/chat/messages"

{messages.map((msg) => (
  <MessageItem
    key={msg.id}
    message={msg}
    agent={agent}
    isActive={msg.id === activeAssistantId}
    streamEnabled={streamEnabled}
    statusStage={statusStage}
    statusCode={statusCode}
    statusMeta={statusMeta}
    lastAssistantId={lastAssistantId}
    isTyping={isTyping}
  />
))}
```

## Requirements 映射

- **Requirement 2.2**: 创建 message-item.tsx 组件用于单条消息展示 ✅
- **Requirement 2.5**: 确保每个组件文件不超过 300 行代码 ✅
- **Requirement 3.1**: 使用 React.memo 包装纯展示组件 ✅
- **Requirement 3.5**: 确保组件不会因父组件重渲染而不必要地重渲染 ✅
- **Requirement 4.1**: 当消息数量超过 50 条时启用虚拟滚动 ✅
- **Requirement 4.3**: 只渲染可见区域的消息 ✅
- **Requirement 4.4**: 保持滚动位置在新消息到达时自动滚动到底部 ✅
- **Requirement 4.5**: 用户向上滚动查看历史时保持滚动位置不变 ✅

## 注意事项

1. **性能优化**：
   - MessageItem 使用了自定义比较函数，确保只在必要时重渲染
   - ChatMessageList 根据消息数量自动选择最优渲染模式
   - 虚拟滚动只渲染可见区域，大幅提升大列表性能

2. **类型安全**：所有 props 都有完整的 TypeScript 类型定义

3. **国际化**：所有用户可见文案都使用 useI18n Hook

4. **UI 规范**：使用 shadcn/ui 组件（Avatar, Button, ScrollArea, ImageLightbox）

5. **响应式设计**：支持移动端和桌面端显示

6. **可访问性**：
   - 头像有 fallback
   - 图片有 alt 文本
   - 滚动按钮有 aria-label

7. **虚拟滚动阈值**：
   - 消息数量 > 50：启用虚拟滚动
   - 消息数量 <= 50：使用普通滚动
   - 可根据实际性能需求调整阈值

8. **滚动行为**：
   - 自动滚动只在用户位于底部时触发
   - 用户手动上滑后会禁用自动滚动
   - 点击"滚动到底部"按钮会重新启用自动滚动

## 后续优化

1. **图片懒加载**：集成 useLazyImage Hook（任务 15.1）
2. ~~**虚拟滚动**：在 ChatMessageList 中集成 react-virtuoso（任务 14.3）~~ ✅ 已完成
3. **测试覆盖**：编写单元测试和性能测试（任务 14.2, 14.4）
4. **性能监控**：添加性能指标收集，监控渲染时间和内存占用
5. **可配置阈值**：将虚拟滚动阈值（50）改为可配置参数
