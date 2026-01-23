# Skeleton Components - 骨架屏组件

本目录包含所有骨架屏组件，用于在内容加载时提供占位显示，提升用户体验。

## 📁 组件列表

### 聊天相关
- **ChatSkeleton** - 聊天界面加载骨架屏
- **CoderSkeleton** - 代码编辑器/控制台加载骨架屏
- **ControlsSkeleton** - 控制面板加载骨架屏

### 图像相关
- **ImageSkeleton** - 图像生成界面加载骨架屏
- **CanvasSkeleton** - 画布容器加载骨架屏

### 通用功能
- **SelectAgentSkeleton** - 助手选择界面加载骨架屏
- **VoiceSkeleton** - 语音工具栏加载骨架屏
- **HudSkeleton** - HUD 显示加载骨架屏

## 🎯 设计原则

### 1. 性能优化
所有骨架屏组件都使用 `React.memo` 包装，避免不必要的重渲染：

```tsx
export const ChatSkeleton = React.memo(() => {
  // 组件实现
})

ChatSkeleton.displayName = "ChatSkeleton"
```

### 2. 统一基础组件
所有骨架屏统一使用 shadcn/ui 的 `Skeleton` 组件作为基础：

```tsx
import { Skeleton } from "@/components/ui/skeleton"
```

### 3. 布局一致性
骨架屏的布局应该与实际内容的布局保持一致，确保加载过程中的视觉连贯性。

## 📦 使用方式

### 基本用法

```tsx
import { ChatSkeleton } from "@/components/common/skeletons"

function ChatPage() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContainer />
    </Suspense>
  )
}
```

### 统一导入

推荐从 index 文件统一导入：

```tsx
import { 
  ChatSkeleton, 
  CoderSkeleton, 
  ControlsSkeleton 
} from "@/components/common/skeletons"
```

### 单独导入

也可以单独导入特定组件：

```tsx
import { ChatSkeleton } from "@/components/common/skeletons/chat-skeleton"
```

## 🔄 迁移说明

### 旧路径（已废弃）
```tsx
// ❌ 不推荐 - 将在未来版本中移除
import { ChatSkeleton } from "@/app/[locale]/chat/components/chat-skeleton"
```

### 新路径（推荐）
```tsx
// ✅ 推荐
import { ChatSkeleton } from "@/components/common/skeletons"
```

### 向后兼容
为了保持向后兼容性，旧路径仍然可用，但已标记为 `@deprecated`。建议尽快迁移到新路径。

## 🎨 设计规范

### 颜色和透明度
- 使用 `bg-accent` 作为基础背景色
- 使用 `animate-pulse` 提供脉动动画效果
- 对于深色背景，使用 `bg-white/10` 等半透明颜色

### 圆角
- 小元素：`rounded` 或 `rounded-md`
- 头像：`rounded-full` 或 `rounded-lg`
- 卡片：`rounded-xl` 或 `rounded-2xl`

### 间距
- 保持与实际内容一致的间距
- 使用 Tailwind 的间距工具类（`gap-*`, `space-*`, `p-*`, `m-*`）

## 📝 开发指南

### 创建新的骨架屏组件

1. **创建组件文件**
```tsx
// components/common/skeletons/my-skeleton.tsx
import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * MySkeleton - 我的功能加载骨架屏
 * 用于我的功能初始加载时的占位显示
 * 
 * @component
 * @example
 * ```tsx
 * <MySkeleton />
 * ```
 */
export const MySkeleton = React.memo(() => {
  return (
    <div className="...">
      <Skeleton className="..." />
    </div>
  )
})

MySkeleton.displayName = "MySkeleton"
```

2. **添加到 index.ts**
```tsx
// components/common/skeletons/index.ts
export { MySkeleton } from "./my-skeleton"
```

3. **使用组件**
```tsx
import { MySkeleton } from "@/components/common/skeletons"

<Suspense fallback={<MySkeleton />}>
  <MyComponent />
</Suspense>
```

### 最佳实践

1. **保持简单** - 骨架屏应该简单明了，不要过度设计
2. **性能优先** - 使用 React.memo 避免不必要的重渲染
3. **布局一致** - 确保骨架屏与实际内容的布局一致
4. **响应式设计** - 考虑不同屏幕尺寸下的显示效果
5. **添加注释** - 为组件添加清晰的 JSDoc 注释

## 🧪 测试

骨架屏组件应该包含以下测试：

1. **渲染测试** - 验证组件能正常渲染
2. **Memo 测试** - 验证 React.memo 优化生效
3. **快照测试** - 确保 UI 不会意外变化

```tsx
// __tests__/chat-skeleton.test.tsx
import { render } from "@testing-library/react"
import { ChatSkeleton } from "../chat-skeleton"

describe("ChatSkeleton", () => {
  it("应该正常渲染", () => {
    const { container } = render(<ChatSkeleton />)
    expect(container).toBeInTheDocument()
  })

  it("应该使用 React.memo 优化", () => {
    expect(ChatSkeleton.displayName).toBe("ChatSkeleton")
  })
})
```

## 📚 相关文档

- [shadcn/ui Skeleton 组件](https://ui.shadcn.com/docs/components/skeleton)
- [React.memo 文档](https://react.dev/reference/react/memo)
- [Next.js Suspense 文档](https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming)

## 🔗 相关组件

- `@/components/ui/skeleton` - 基础 Skeleton 组件
- `@/components/ui/loading-skeletons` - 其他加载状态组件

## 📋 变更日志

### 2024-01 - 初始迁移
- ✅ 将所有骨架屏组件从 `app/[locale]/chat/components/` 迁移到 `components/common/skeletons/`
- ✅ 所有组件使用 React.memo 包装优化性能
- ✅ 统一使用 shadcn/ui 的 Skeleton 组件
- ✅ 更新所有导入路径
- ✅ 在旧位置添加重导出以保持向后兼容性
- ✅ 添加完整的 JSDoc 注释和 displayName

## 🤝 贡献指南

在添加或修改骨架屏组件时，请确保：

1. ✅ 使用 React.memo 包装组件
2. ✅ 使用 shadcn/ui 的 Skeleton 组件
3. ✅ 添加 displayName
4. ✅ 添加 JSDoc 注释
5. ✅ 在 index.ts 中导出
6. ✅ 更新此 README 文档
7. ✅ 编写相应的测试

---

**维护者**: AI-Higress-Gateway Team  
**最后更新**: 2024-01
