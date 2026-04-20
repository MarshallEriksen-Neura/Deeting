# Workspace Components

工作区组件目录，包含工作区布局相关的组件。

## 组件列表

### WorkspaceShell (workspace-shell.tsx)

工作区外壳组件，提供主内容区和侧边工作区的布局。

**功能：**
- 响应式网格布局（主内容区 + 侧边工作区）
- 根据工作区视图数量自动显示/隐藏侧边栏
- 平滑的过渡动画

**性能优化：**
- 使用 `React.memo` 避免不必要的重渲染
- 使用 `useShallow` 优化 Zustand store 订阅

**Props：**

```typescript
interface WorkspaceShellProps {
  children: ReactNode      // 主内容区
  workspace: ReactNode     // 侧边工作区内容
}
```

**使用示例：**

```tsx
import { WorkspaceShell } from '@/components/common/workspace'

export default function Layout({ children }) {
  return (
    <WorkspaceShell
      workspace={<WorkspacePanel />}
    >
      {children}
    </WorkspaceShell>
  )
}
```

## 布局说明

组件使用 CSS Grid 布局：
- 主内容区：`minmax(0, 1fr)` - 占据剩余空间
- 侧边工作区：`auto` - 根据内容自动调整
  - 有视图时：`w-[40%] min-w-[400px] max-w-[720px]`
  - 无视图时：`w-0` - 完全隐藏

## 依赖

- `@/store/workspace-store` - 工作区状态管理
- `@/lib/utils` - 工具函数（cn）

## 迁移说明

此组件已从 `app/[locale]/chat/components/workspace-shell.tsx` 迁移至此。

**迁移日期：** 2024

**变更：**
- 添加了 React.memo 性能优化
- 添加了详细的 TypeScript 类型定义
- 添加了详细的 JSDoc 注释

**向后兼容：**
原路径仍然可用，通过重导出保持兼容性。
