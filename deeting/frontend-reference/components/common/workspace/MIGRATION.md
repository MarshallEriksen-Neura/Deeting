# Workspace Components Migration Guide

## 迁移概述

Workspace 组件已从 `app/[locale]/chat/components/` 迁移到 `components/common/workspace/`。

## 迁移日期

2024年

## 变更内容

### 1. 文件位置变更

**旧路径：**
```
app/[locale]/chat/components/workspace-shell.tsx
```

**新路径：**
```
components/common/workspace/workspace-shell.tsx
components/common/workspace/index.ts
components/common/workspace/README.md
components/common/workspace/MIGRATION.md
```

### 2. 导入路径变更

**旧导入方式：**
```typescript
import { WorkspaceShell } from './components/workspace-shell'
```

**新导入方式：**
```typescript
import { WorkspaceShell } from '@/components/common/workspace'
```

### 3. 性能优化

新版本添加了以下性能优化：

1. **React.memo 优化**
   - 组件使用 `React.memo` 包装
   - 避免父组件重渲染时的不必要更新

2. **useShallow 优化**
   - Zustand store 订阅使用 `useShallow`
   - 只在 `views.length` 变化时触发更新

### 4. 代码改进

1. **添加了 TypeScript 类型定义**
   ```typescript
   interface WorkspaceShellProps {
     children: ReactNode
     workspace: ReactNode
   }
   ```

2. **添加了详细的 JSDoc 注释**
   - 组件功能说明
   - 性能优化说明
   - 参数说明

3. **改进了组件命名**
   - 使用具名导出
   - 添加了 displayName

## 迁移步骤

### 对于使用此组件的代码

1. **更新导入语句**
   ```typescript
   // 旧
   import { WorkspaceShell } from './components/workspace-shell'
   
   // 新
   import { WorkspaceShell } from '@/components/common/workspace'
   ```

2. **组件使用方式不变**
   ```typescript
   <WorkspaceShell workspace={<WorkspacePanel />}>
     {children}
   </WorkspaceShell>
   ```

3. **验证功能**
   - 确保工作区正常显示/隐藏
   - 确保过渡动画正常
   - 确保响应式布局正常

## 已更新的文件

以下文件已更新为使用新路径：

1. `deeting/app/[locale]/chat/layout.tsx`
   - 更新导入路径

## 向后兼容性

原路径 `app/[locale]/chat/components/workspace-shell.tsx` 暂时保留，但已标记为 deprecated。

**建议：** 尽快迁移到新路径，旧路径将在未来版本中移除。

## 测试清单

迁移后请验证以下功能：

- [ ] 工作区外壳正常渲染
- [ ] 主内容区正常显示
- [ ] 侧边工作区在有视图时正常显示
- [ ] 侧边工作区在无视图时正常隐藏
- [ ] 过渡动画流畅
- [ ] 响应式布局正常
- [ ] 侧边栏宽度限制正常（40%, min 400px, max 720px）
- [ ] 无障碍属性正常（aria-hidden）

## 性能验证

使用 React DevTools Profiler 验证性能优化效果：

1. 打开 React DevTools
2. 切换到 Profiler 标签
3. 开始录制
4. 执行以下操作：
   - 打开/关闭工作区视图
   - 在主内容区进行操作
5. 停止录制
6. 检查 WorkspaceShell 组件的渲染次数

**预期结果：**
- WorkspaceShell 只在 `views.length` 变化时重渲染
- 主内容区的更新不应该触发 WorkspaceShell 重渲染

## 问题排查

### 问题：导入错误

**症状：** `Cannot find module '@/components/common/workspace'`

**解决方案：**
1. 确保 TypeScript 路径别名配置正确
2. 重启开发服务器
3. 清除 Next.js 缓存：`rm -rf .next`

### 问题：工作区不显示

**症状：** 侧边工作区始终不显示

**解决方案：**
1. 检查 `workspace-store` 中的 `views` 数组
2. 确保至少有一个视图被添加
3. 检查 CSS 类名是否正确应用

### 问题：布局错乱

**症状：** 主内容区和侧边栏布局不正确

**解决方案：**
1. 检查父容器是否有正确的高度和宽度
2. 确保 Grid 布局正常工作
3. 检查浏览器控制台是否有 CSS 错误

## 布局说明

WorkspaceShell 使用 CSS Grid 布局：

```css
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  height: 100vh;
  width: 100vw;
}
```

- **主内容区：** `minmax(0, 1fr)` - 占据剩余空间，最小宽度为 0
- **侧边工作区：** `auto` - 根据内容自动调整宽度

侧边栏宽度规则：
- 有视图时：`w-[40%] min-w-[400px] max-w-[720px]`
- 无视图时：`w-0 overflow-hidden pointer-events-none`

## 相关文档

- [Workspace Components README](./README.md)
- [Chat Components Refactor Design](.kiro/specs/chat-components-refactor/design.md)
- [Chat Components Refactor Tasks](.kiro/specs/chat-components-refactor/tasks.md)

## 支持

如有问题，请查看：
1. 组件 README 文档
2. 设计文档
3. 任务列表
4. 提交 Issue
