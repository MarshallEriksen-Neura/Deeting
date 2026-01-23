# ChatInput 组件迁移指南

本文档说明 ChatInput 组件从 `app/[locale]/chat/components/` 迁移到 `components/chat/input/` 的变更和迁移步骤。

## 变更概述

### 迁移路径

```
旧路径: deeting/app/[locale]/chat/components/chat-input.tsx
新路径: deeting/components/chat/input/chat-input.tsx
```

### 主要改进

1. **性能优化**
   - ✅ 使用 `useDebounce` Hook 对输入事件防抖（300ms）
   - ✅ 使用 `useCallback` 缓存所有事件处理函数
   - ✅ 使用 `React.memo` 包装组件，带自定义比较函数
   - ✅ 使用 `useMemo` 缓存错误消息解析

2. **组件拆分**
   - ✅ 附件预览逻辑提取到独立的 `AttachmentPreview` 组件
   - ✅ 减少组件复杂度，提升可维护性

3. **代码质量**
   - ✅ 完整的 TypeScript 类型定义
   - ✅ 详细的 JSDoc 注释
   - ✅ 更清晰的代码结构

## API 兼容性

### Props 接口

**完全兼容** - 所有 props 保持不变，无需修改使用代码。

```typescript
interface ChatInputProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  placeholderName: string
  errorMessage: string | null
  attachments: ChatImageAttachment[]
  onRemoveAttachment: (attachmentId: string) => void
  onClearAttachments: () => void
  streamEnabled: boolean
  onStreamChange: (enabled: boolean) => void
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void
  isGenerating?: boolean
  onCancel?: () => void
}
```

### 行为变化

#### 1. 输入防抖

**旧行为：** 输入值立即传递给父组件，无防抖处理。

**新行为：** 
- 输入值仍然立即更新显示（受控输入）
- 内部使用防抖值（300ms）进行某些优化
- 对外部使用者透明，无需修改代码

#### 2. 附件预览

**旧行为：** 附件预览 JSX 内联在 ChatInput 组件中。

**新行为：** 
- 使用独立的 `AttachmentPreview` 组件
- 支持图片懒加载
- 更好的性能和可维护性
- 对外部使用者透明，无需修改代码

#### 3. 性能优化

**旧行为：** 每次父组件重渲染时，ChatInput 都会重渲染。

**新行为：** 
- 使用 `React.memo` 优化，只在必要时重渲染
- 所有事件处理函数使用 `useCallback` 缓存
- 对外部使用者透明，但需要确保传递的回调函数也被缓存

## 迁移步骤

### 步骤 1：更新导入路径

```typescript
// 旧代码
import { ChatInput } from '@/app/[locale]/chat/components/chat-input'

// 新代码
import { ChatInput } from '@/components/chat/input/chat-input'
```

### 步骤 2：确保回调函数被缓存（推荐）

为了充分利用 `React.memo` 优化，建议使用 `useCallback` 缓存传递给 ChatInput 的回调函数：

```typescript
// 推荐做法
function ChatContainer() {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([])
  
  // 使用 useCallback 缓存回调函数
  const handleSend = useCallback(() => {
    // 发送逻辑
  }, [/* 依赖项 */])
  
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])
  
  const handleClearAttachments = useCallback(() => {
    setAttachments([])
  }, [])
  
  return (
    <ChatInput
      inputValue={input}
      onInputChange={setInput}
      onSend={handleSend}
      onRemoveAttachment={handleRemoveAttachment}
      onClearAttachments={handleClearAttachments}
      // ... 其他 props
    />
  )
}
```

### 步骤 3：验证功能

迁移后，请验证以下功能：

- [ ] 消息输入和发送
- [ ] 附件上传（选择文件、拖拽、粘贴）
- [ ] 附件预览和删除
- [ ] 流式/批量模式切换
- [ ] 取消正在生成的消息
- [ ] 错误消息显示
- [ ] 键盘快捷键（Enter 发送）
- [ ] 禁用状态

## 向后兼容

### 临时重导出

旧的导入路径仍然可用（通过重导出），但会显示 `@deprecated` 警告：

```typescript
// deeting/app/[locale]/chat/components/chat-input.tsx
/**
 * @deprecated 请从 @/components/chat/input/chat-input 导入
 */
export { ChatInput } from '@/components/chat/input/chat-input'
```

### 移除时间表

- **当前版本**：旧路径可用，显示弃用警告
- **下一个主版本**：移除旧路径的重导出

## 性能对比

### 渲染性能

| 场景 | 旧版本 | 新版本 | 改进 |
|------|--------|--------|------|
| 父组件重渲染 | 总是重渲染 | 仅在 props 变化时重渲染 | ✅ 显著提升 |
| 输入事件 | 立即处理 | 防抖处理（300ms） | ✅ 减少处理次数 |
| 附件预览 | 内联渲染 | 独立组件 + 懒加载 | ✅ 提升加载性能 |

### 内存占用

- **旧版本**：所有事件处理函数在每次渲染时重新创建
- **新版本**：使用 `useCallback` 缓存，减少内存分配

## 常见问题

### Q1: 为什么输入有延迟？

A: 输入显示没有延迟（立即更新），防抖只应用于内部优化，不影响用户体验。

### Q2: 如何禁用防抖？

A: 防抖是内部实现细节，对外部透明。如果确实需要禁用，可以修改 `useDebounce` 的延迟参数。

### Q3: 附件预览加载慢？

A: 新版本使用懒加载技术，只在图片进入视口时才加载，这是性能优化的一部分。

### Q4: 如何测试性能改进？

A: 使用 React DevTools Profiler 对比迁移前后的渲染次数和时间。

## 相关文档

- [ChatInput 组件文档](./README.md)
- [AttachmentPreview 组件文档](./README.md#attachmentpreview)
- [性能优化指南](../../../.kiro/specs/chat-components-refactor/design.md#性能优化组件)
- [useDebounce Hook 文档](../../hooks/use-debounce.ts)

## 需要帮助？

如果在迁移过程中遇到问题，请：

1. 检查本文档的常见问题部分
2. 查看组件文档和示例代码
3. 在项目中搜索类似的使用案例
4. 联系开发团队获取支持
