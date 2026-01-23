# 图像组件使用指南

## 概述

本目录包含所有与图像生成相关的组件，包括图像仪表板、历史记录侧边栏和画布容器。

## 目录结构

```
components/image/
├── dashboard/              # 图像仪表板
│   └── image-dashboard.tsx
├── history/                # 图像历史
│   └── image-history-sidebar.tsx
├── canvas/                 # 画布
│   ├── canvas-container.tsx
│   └── canvas-skeleton.tsx
├── MIGRATION.md           # 迁移文档
└── README.md              # 本文档
```

## 组件说明

### ImageDashboard

图像生成仪表板组件，提供图像生成的主界面。

**功能：**
- 图像生成任务管理
- 实时状态更新（队列、处理、完善、完成）
- 画布尺寸自适应
- 会话历史管理
- 文件上传支持

**使用示例：**

```typescript
import ImageDashboard from "@/components/image/dashboard/image-dashboard";

export default function ImagePage() {
  return <ImageDashboard />;
}
```

**性能特性：**
- ✅ 代码分割：动态导入大型视觉组件
- ✅ useMemo 优化：缓存计算结果
- ✅ useCallback 优化：缓存事件处理函数
- ✅ 响应式设计：自适应不同屏幕尺寸

**依赖：**
- `@/hooks/use-i18n` - 国际化
- `@/hooks/use-chat-service` - 聊天服务
- `@/store/image-generation-store` - 图像生成状态管理
- `@/lib/swr/use-image-generation-tasks` - 任务数据获取
- `@/components/ui/glass-card` - 玻璃卡片组件
- `@/components/ui/image-lightbox` - 图片灯箱

### ImageHistorySidebar

图像生成历史侧边栏组件，显示历史生成记录。

**功能：**
- 显示图像生成历史
- 按会话分组
- 搜索和过滤
- 无限滚动加载
- 图片懒加载
- 任务详情预览

**使用示例：**

```typescript
import { ImageHistorySidebar } from "@/components/image/history/image-history-sidebar";

export default function ImagePage() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>打开历史</button>
      <ImageHistorySidebar 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
      />
    </>
  );
}
```

**Props：**

| 属性 | 类型 | 必需 | 说明 |
|------|------|------|------|
| isOpen | boolean | ✅ | 是否打开侧边栏 |
| onClose | () => void | ✅ | 关闭回调函数 |

**性能特性：**
- ✅ 图片懒加载：只加载可见区域的图片
- ✅ React.memo 优化：优化列表项渲染
- ✅ useMemo 优化：缓存分组和过滤结果
- ✅ useCallback 优化：缓存事件处理函数
- ✅ 无限滚动：按需加载历史记录

**依赖：**
- `@/hooks/use-i18n` - 国际化
- `@/hooks/use-lazy-image` - 图片懒加载
- `@/lib/swr/use-image-generation-tasks` - 任务数据获取
- `@/components/ui/infinite-list` - 无限滚动列表
- `@/components/ui/dialog` - 对话框
- `framer-motion` - 动画

### Canvas

聊天画布容器组件，显示聊天消息列表。

**功能：**
- 显示聊天消息列表
- 自动滚动到底部
- 加载历史消息
- 动态调整布局偏移
- 支持文本和图片附件
- 流式响应显示

**使用示例：**

```typescript
import Canvas from "@/components/image/canvas/canvas-container";

export default function ChatPage() {
  return <Canvas />;
}
```

**性能特性：**
- ✅ 代码分割：动态导入 AIResponseBubble
- ✅ React.memo 优化：优化消息组件渲染
- ✅ 原生懒加载：附件图片使用 loading="lazy"
- ✅ useMemo 优化：缓存最后一条助手消息
- ✅ useCallback 优化：缓存加载更多函数
- ✅ Suspense 支持：优雅的加载状态

**依赖：**
- `@/store/chat-store` - 聊天状态管理
- `@/hooks/use-i18n` - 国际化
- `@/components/chat/markdown-viewer` - Markdown 渲染
- `@/components/common/skeletons` - 骨架屏
- `zustand` - 状态管理

## 性能优化

### 代码分割

所有大型组件都使用动态导入实现代码分割：

```typescript
// ImageDashboard
const StatusStream = dynamic(
  () => import("...").then(mod => ({ default: mod.StatusStream })),
  { ssr: false }
);

// Canvas
const AIResponseBubble = lazy(() =>
  import("...").then(mod => ({ default: mod.AIResponseBubble }))
);
```

### 懒加载

图片使用懒加载技术，只在进入视口时加载：

```typescript
// 使用自定义 Hook
const { imageSrc, isLoading, error, imgRef } = useLazyImage({
  src,
  rootMargin: '50px',
  threshold: 0.01,
});

// 或使用原生属性
<img src={url} loading="lazy" />
```

### React.memo

所有纯展示组件都使用 React.memo 优化：

```typescript
const LazyImage = memo<Props>(({ src, alt }) => {
  // 组件实现
});

LazyImage.displayName = 'LazyImage';
```

### useMemo 和 useCallback

适当使用 useMemo 和 useCallback 缓存计算和函数：

```typescript
// 缓存计算结果
const filteredGroups = useMemo(() => {
  return groups.filter(group => group.searchText.includes(search));
}, [groups, search]);

// 缓存事件处理函数
const handleClick = useCallback(() => {
  // 处理逻辑
}, [dependencies]);
```

## 状态管理

### ImageGenerationStore

图像生成相关的状态管理：

```typescript
import { useImageGenerationStore } from "@/store/image-generation-store";

const {
  selectedModelId,
  setSelectedModelId,
  sessionId,
  setSessionId,
  ratio,
  steps,
  guidance,
} = useImageGenerationStore();
```

### ChatStore

聊天相关的状态管理：

```typescript
import { useChatStore } from "@/store/chat-store";

const {
  messages,
  isLoading,
  historyHasMore,
  loadMoreHistory,
} = useChatStore();
```

## 数据获取

### useImageGenerationTasks

获取图像生成任务列表：

```typescript
import { useImageGenerationTasks } from "@/lib/swr/use-image-generation-tasks";

const {
  items,
  hasMore,
  isLoadingMore,
  error,
  loadMore,
  reset,
} = useImageGenerationTasks(
  { size: 24, include_outputs: true },
  { enabled: true }
);
```

## 国际化

所有组件都支持国际化：

```typescript
import { useI18n } from "@/hooks/use-i18n";

const t = useI18n("chat");

// 使用翻译
<h1>{t("image.emptyState.title")}</h1>
```

**相关 i18n keys：**
- `chat.image.*` - 图像相关文案
- `chat.imageHistory.*` - 历史记录文案
- `chat.canvas.*` - 画布文案
- `chat.status.*` - 状态文案
- `chat.error.*` - 错误文案

## 样式规范

### 使用 shadcn/ui 组件

所有 UI 组件都使用 shadcn/ui：

```typescript
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
```

### Tailwind CSS

使用 Tailwind CSS 进行样式定制：

```typescript
<div className="rounded-2xl px-5 py-3 bg-white/70 dark:bg-white/[0.03]">
  {/* 内容 */}
</div>
```

### 响应式设计

支持移动端和桌面端：

```typescript
<div className="w-full md:w-96 lg:w-[32rem]">
  {/* 内容 */}
</div>
```

## 测试

### 单元测试

```typescript
import { render, screen } from "@testing-library/react";
import ImageDashboard from "@/components/image/dashboard/image-dashboard";

describe("ImageDashboard", () => {
  it("应该渲染空状态", () => {
    render(<ImageDashboard />);
    expect(screen.getByText("开始创作")).toBeInTheDocument();
  });
});
```

### 性能测试

```typescript
import { renderHook } from "@testing-library/react";
import { useLazyImage } from "@/hooks/use-lazy-image";

describe("useLazyImage", () => {
  it("应该在图片进入视口时加载", async () => {
    const { result } = renderHook(() => 
      useLazyImage({ src: "test.jpg" })
    );
    
    // 测试懒加载行为
  });
});
```

## 常见问题

### Q: 图片不显示？

A: 检查以下几点：
1. 图片 URL 是否正确
2. 是否有网络错误
3. 是否启用了懒加载（可能需要滚动到可见区域）
4. 检查浏览器控制台是否有错误

### Q: 历史记录加载慢？

A: 这是正常的，因为：
1. 使用了图片懒加载，只加载可见区域
2. 使用了无限滚动，按需加载
3. 可以调整 `size` 参数减少每次加载的数量

### Q: 代码分割后组件加载有延迟？

A: 这是正常的，因为：
1. 动态导入的组件需要额外的网络请求
2. 可以通过预加载优化：`<link rel="prefetch" href="..." />`
3. 延迟通常很短（< 100ms）

### Q: 如何更新导入路径？

A: 使用查找替换：
```bash
# 查找旧路径
rg "@/app/\[locale\]/chat/components/image-dashboard"

# 替换为新路径
@/components/image/dashboard/image-dashboard
```

## 最佳实践

1. **使用新的导入路径**：虽然旧路径仍然可用，但建议使用新路径
2. **合理使用懒加载**：对于大量图片，懒加载可以显著提升性能
3. **避免过度优化**：只在必要时使用 memo 和 callback
4. **保持组件单一职责**：每个组件只负责一个功能
5. **使用 TypeScript**：确保类型安全
6. **编写测试**：确保组件功能正确

## 相关资源

- [迁移文档](./MIGRATION.md)
- [性能优化指南](../../docs/performance-optimization.md)
- [代码分割指南](../../docs/code-splitting.md)
- [懒加载实现](../../hooks/use-lazy-image.ts)
- [shadcn/ui 文档](https://ui.shadcn.com/)
- [Framer Motion 文档](https://www.framer.com/motion/)

## 贡献指南

如果你想为这些组件做出贡献：

1. 遵循现有的代码风格
2. 添加适当的 TypeScript 类型
3. 编写单元测试
4. 更新文档
5. 确保性能优化不影响功能
6. 提交 PR 前运行所有测试

## 许可证

MIT
