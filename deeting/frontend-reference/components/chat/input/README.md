# Chat Input Components

本目录包含聊天输入相关的组件。

## 组件列表

### ChatInput

聊天输入框组件，提供消息输入、附件上传、流式模式切换等功能。

**特性：**
- ✅ 使用 React.memo 优化性能
- ✅ 使用 useDebounce Hook 对输入事件防抖（300ms）
- ✅ 使用 useCallback 缓存所有事件处理函数
- ✅ 使用 AttachmentPreview 组件展示附件
- ✅ 使用 shadcn/ui 的 Input 和 Button 组件
- ✅ 支持图片附件上传（拖拽、粘贴、选择文件）
- ✅ 支持流式/批量模式切换
- ✅ 支持取消正在生成的消息
- ✅ 完整的国际化支持
- ✅ 完整的错误处理

**使用示例：**

```tsx
import { ChatInput } from "@/components/chat/input/chat-input"

function ChatContainer() {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([])
  const [streamEnabled, setStreamEnabled] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  
  const handleSend = () => {
    // 发送消息逻辑
  }
  
  const handleCancel = () => {
    // 取消生成逻辑
  }
  
  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }
  
  const handleClearAttachments = () => {
    setAttachments([])
  }
  
  return (
    <ChatInput
      inputValue={input}
      onInputChange={setInput}
      onSend={handleSend}
      disabled={isGenerating}
      placeholderName="AI Assistant"
      errorMessage={null}
      attachments={attachments}
      onRemoveAttachment={handleRemoveAttachment}
      onClearAttachments={handleClearAttachments}
      streamEnabled={streamEnabled}
      onStreamChange={setStreamEnabled}
      isGenerating={isGenerating}
      onCancel={handleCancel}
    />
  )
}
```

**Props：**

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| inputValue | `string` | 必需 | 输入框的值 |
| onInputChange | `(value: string) => void` | 必需 | 输入变化回调 |
| onSend | `() => void` | 必需 | 发送消息回调 |
| disabled | `boolean` | 必需 | 是否禁用输入 |
| placeholderName | `string` | 必需 | 占位符中显示的名称 |
| errorMessage | `string \| null` | 必需 | 错误消息 |
| attachments | `ChatImageAttachment[]` | 必需 | 附件列表 |
| onRemoveAttachment | `(id: string) => void` | 必需 | 删除附件回调 |
| onClearAttachments | `() => void` | 必需 | 清空附件回调 |
| streamEnabled | `boolean` | 必需 | 是否启用流式模式 |
| onStreamChange | `(enabled: boolean) => void` | 必需 | 流式模式切换回调 |
| onPaste | `(event: React.ClipboardEvent) => void` | 可选 | 粘贴事件回调 |
| isGenerating | `boolean` | 可选 | 是否正在生成 |
| onCancel | `() => void` | 可选 | 取消生成回调 |

**性能优化：**

1. **React.memo**：组件使用 React.memo 包装，带有自定义比较函数，只在必要时重渲染
2. **防抖优化**：使用 useDebounce Hook 对输入值防抖（300ms），优化性能
3. **useCallback**：所有事件处理函数都使用 useCallback 缓存，避免子组件不必要的重渲染
4. **useMemo**：错误消息解析使用 useMemo 缓存

**Requirements 验证：**
- ✅ Requirements 6.1: 输入防抖 - 使用 useDebounce Hook 对输入事件防抖（300ms）
- ✅ Requirements 3.3: useCallback 优化 - 使用 useCallback 缓存事件处理函数
- ✅ Requirements 9.4, 9.5: UI 组件规范 - 使用 shadcn/ui 的 Input 和 Button 组件
- ✅ Requirements 2.3: 组件职责拆分 - 使用 AttachmentPreview 组件
- ✅ Requirements 3.1: React.memo 优化 - 使用 React.memo 包装组件
- ✅ Requirements 12.1: 国际化支持 - 使用 useI18n Hook

### AttachmentPreview

附件预览组件，用于展示聊天消息中的图片附件。

**特性：**
- ✅ 使用 React.memo 优化性能
- ✅ 使用 useLazyImage Hook 实现图片懒加载
- ✅ 支持两种变体：assistant（助手消息）和 user（用户输入）
- ✅ 支持删除单个附件和清空所有附件
- ✅ 显示图片加载状态和错误状态
- ✅ 使用 shadcn/ui 组件
- ✅ 完整的国际化支持

**使用示例：**

```tsx
import { AttachmentPreview } from "@/components/chat/input/attachment-preview"

// 用户输入场景（可编辑）
function ChatInput() {
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([])
  
  const handleRemove = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }
  
  const handleClear = () => {
    setAttachments([])
  }
  
  return (
    <AttachmentPreview
      attachments={attachments}
      variant="user"
      onRemove={handleRemove}
      onClear={handleClear}
      disabled={false}
    />
  )
}

// 助手消息场景（只读）
function MessageItem({ message }: { message: Message }) {
  return (
    <AttachmentPreview
      attachments={message.attachments}
      variant="assistant"
    />
  )
}
```

**Props：**

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| attachments | `ChatImageAttachment[]` | 必需 | 附件列表 |
| variant | `'assistant' \| 'user'` | `'user'` | 变体类型 |
| onRemove | `(id: string) => void` | 可选 | 删除单个附件的回调 |
| onClear | `() => void` | 可选 | 清空所有附件的回调 |
| disabled | `boolean` | 可选 | 是否禁用交互 |
| className | `string` | 可选 | 自定义类名 |

**性能优化：**

1. **React.memo**：组件使用 React.memo 包装，带有自定义比较函数，只在必要时重渲染
2. **懒加载**：使用 useLazyImage Hook 实现图片懒加载，只在图片进入视口时才加载
3. **子组件优化**：AttachmentItem 子组件也使用 React.memo 优化

**Requirements 验证：**
- ✅ Requirements 2.3: 组件职责拆分 - 从 chat-input.tsx 中提取附件预览逻辑
- ✅ Requirements 5.1: 图片懒加载 - 使用 useLazyImage Hook 实现
- ✅ Requirements 3.1: React.memo 优化 - 使用 React.memo 包装组件
- ✅ Requirements 9.1: UI 组件规范 - 使用 shadcn/ui 组件
- ✅ Requirements 12.1: 国际化支持 - 使用 useI18n Hook

## 相关文件

- `chat-input.tsx` - ChatInput 组件实现
- `attachment-preview.tsx` - AttachmentPreview 组件实现
- `../../hooks/use-debounce.ts` - 防抖 Hook
- `../../hooks/use-lazy-image.ts` - 图片懒加载 Hook
- `../../lib/chat/message-content.ts` - ChatImageAttachment 类型定义
- `../../lib/chat/attachments.ts` - 附件处理工具函数
- `../../store/chat-state-store.ts` - 聊天状态 Store
- `../../messages/*/chat.json` - 国际化文案

## 迁移说明

如果你正在从旧的 `app/[locale]/chat/components/chat-input.tsx` 迁移到新的组件结构：

### 1. 更新导入路径

```tsx
// 旧代码
import { ChatInput } from '@/app/[locale]/chat/components/chat-input'

// 新代码
import { ChatInput } from '@/components/chat/input/chat-input'
```

### 2. 组件 API 保持不变

ChatInput 组件的 props 接口保持完全兼容，无需修改使用代码。

### 3. 性能提升

新版本的 ChatInput 组件包含以下性能优化：

- **防抖优化**：输入事件使用 300ms 防抖，减少不必要的处理
- **useCallback 优化**：所有事件处理函数都使用 useCallback 缓存
- **React.memo 优化**：组件使用 React.memo 包装，避免不必要的重渲染
- **组件拆分**：附件预览逻辑拆分到独立的 AttachmentPreview 组件

### 4. 向后兼容

旧的导入路径仍然可用（通过重导出），但建议尽快迁移到新路径。旧路径将在未来版本中移除。

## 开发指南

### 添加新功能

如果需要为 ChatInput 添加新功能：

1. 确保新功能符合单一职责原则
2. 如果功能复杂，考虑拆分为独立组件
3. 使用 useCallback 缓存事件处理函数
4. 使用 useMemo 缓存计算结果
5. 更新 TypeScript 类型定义
6. 添加相应的国际化文案
7. 更新文档和示例

### 性能优化建议

1. **避免内联函数**：使用 useCallback 缓存所有传递给子组件的函数
2. **避免内联对象**：使用 useMemo 缓存传递给子组件的对象
3. **合理使用防抖**：对频繁触发的事件应用防抖，但不要过度使用
4. **监控性能**：使用 React DevTools Profiler 监控组件渲染性能

### 测试建议

1. **单元测试**：测试组件的渲染和交互行为
2. **防抖测试**：使用 jest.useFakeTimers 测试防抖行为
3. **性能测试**：测试 React.memo 和 useCallback 的优化效果
4. **集成测试**：测试与其他组件的交互
5. **可访问性测试**：确保键盘导航和屏幕阅读器支持

## 相关文档

- [Chat Components Refactor Design](../../../.kiro/specs/chat-components-refactor/design.md)
- [Performance Optimization Guide](../../../docs/performance-optimization.md)
- [Component Testing Guide](../../../docs/testing-guide.md)
