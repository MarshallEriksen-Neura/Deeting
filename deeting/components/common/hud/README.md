# HUD Components

HUD（Heads-Up Display）组件目录，包含聊天界面的顶部显示组件。

## 组件列表

### HUD (hud-container.tsx)

主 HUD 容器组件，显示聊天界面的顶部控制栏。

**功能：**
- 模型选择器（支持聊天和图像生成模型）
- 会话标题显示
- 历史记录侧边栏触发器
- 系统菜单（导航、主题切换、登出）
- 状态指示器

**性能优化：**
- 使用 `useCallback` 缓存所有事件处理函数
- 使用 `useMemo` 缓存计算结果（activeAssistant）
- 使用 `useShallow` 优化 Zustand store 订阅

**使用示例：**

```tsx
import HUD from '@/components/common/hud'

export default function ChatPage() {
  return (
    <div>
      <HUD />
      {/* 其他内容 */}
    </div>
  )
}
```

## 依赖

- `@/store/chat-store` - 聊天状态管理
- `@/store/image-generation-store` - 图像生成状态管理
- `@/hooks/use-chat-service` - 聊天服务 Hook
- `@/hooks/use-i18n` - 国际化 Hook
- `@/components/models/model-picker` - 模型选择器
- `@/components/ui/status-pill` - 状态指示器
- `framer-motion` - 动画库

## 迁移说明

此组件已从 `app/[locale]/chat/components/hud-container.tsx` 迁移至此。

**迁移日期：** 2024

**变更：**
- 添加了性能优化（useCallback、useMemo）
- 更新了导入路径以使用新的组件结构
- 添加了详细的 JSDoc 注释

**向后兼容：**
原路径仍然可用，通过重导出保持兼容性。
