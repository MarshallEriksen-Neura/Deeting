# Chat Visuals Components

此目录包含聊天视觉效果相关的组件。

## 组件列表

### dynamic-background.tsx

**功能：** 动态背景组件

**职责：**
- 提供聊天界面的动态背景效果
- 支持亮色和暗色模式
- 使用渐变和模糊效果创建氛围感

**性能优化：**
- 使用 `React.memo` 优化（纯展示组件，无 props）
- 使用 CSS 动画而非 JS 动画
- 使用 `pointer-events-none` 避免影响交互

**使用示例：**
```tsx
import DynamicBackground from '@/components/chat/visuals/dynamic-background'

function ChatPage() {
  return (
    <div className="relative">
      <DynamicBackground />
      {/* 其他内容 */}
    </div>
  )
}
```

**视觉效果：**
- **亮色模式：** 柔和的彩色光晕（紫色、青色、粉色）
- **暗色模式：** 更加微妙的深色光晕
- **动画：** 使用 CSS 动画实现脉动和移动效果

**CSS 类：**
- `animate-pulse-slow` - 慢速脉动动画
- `animate-pulse-slower` - 更慢的脉动动画
- `animate-blob` - 移动动画

**迁移说明：**
- 原路径：`deeting/app/[locale]/chat/components/dynamic-background.tsx`
- 新路径：`deeting/components/chat/visuals/dynamic-background.tsx`
- 迁移日期：2024
- 性能优化：添加了 React.memo

**注意事项：**
- 这是一个纯展示组件，没有 props
- 使用绝对定位，需要父容器有 `relative` 定位
- 不影响页面交互（`pointer-events-none`）

## 相关组件

- `status-visuals.tsx` - 状态视觉效果组件
