# 服务端组件静态分析脚本

## 概述

`analyze-server-components.ts` 是一个静态分析工具，用于扫描前端项目中的所有 `page.tsx` 文件，检测不必要的 `"use client"` 声明，并生成详细的优化建议报告。

## 功能特性

1. **自动扫描**: 递归扫描 `app/` 目录下的所有 `page.tsx` 文件
2. **智能分析**: 检测组件是否真的需要客户端渲染
3. **详细报告**: 生成包含统计数据和优化建议的 Markdown 报告
4. **优先级分类**: 将优化任务按优先级分为高、中、低三个等级

## 使用方法

### 运行脚本

```bash
# 在 frontend 目录下运行
cd frontend

# 使用 npm script
bun run analyze:server-components

# 或直接运行
bun run scripts/analyze-server-components.ts
```

### 查看报告

脚本运行后会在 `frontend/` 目录下生成 `server-components-analysis-report.md` 文件。

## 分析逻辑

### 客户端组件特征检测

脚本会检测以下客户端组件特征：

#### 1. React Hooks
- `useState`, `useEffect`, `useReducer`
- `useCallback`, `useMemo`, `useRef`
- `useContext`, `useLayoutEffect`
- `useTransition`, `useDeferredValue`, `useId`

#### 2. 事件处理器
- `onClick`, `onChange`, `onSubmit`
- `onFocus`, `onBlur`
- `onKeyDown`, `onKeyUp`
- `onMouseEnter`, `onMouseLeave`
- `onScroll`

#### 3. 浏览器 API
- `window.*`
- `document.*`
- `localStorage`, `sessionStorage`
- `navigator.*`, `location.*`

### 优先级分类

#### 🔴 高优先级（可直接优化）
- 包含 `"use client"` 但没有检测到任何客户端特征
- **操作**: 直接移除 `"use client"` 声明

#### 🟡 中优先级（需要重构）
- 包含 `"use client"` 且检测到客户端特征
- **操作**: 将交互逻辑拆分到独立的客户端组件

#### 🟢 低优先级（需要检查）
- 未声明 `"use client"` 但检测到客户端特征
- **操作**: 确认是否需要调整组件结构

## 报告内容

生成的报告包含以下部分：

### 1. 统计摘要
- 总页面数
- 使用 `"use client"` 的页面数量和比例
- 不必要的 `"use client"` 数量
- 需要重构的页面数量
- 正确的服务端组件数量

### 2. 优化建议
按优先级列出每个需要优化的页面：
- 文件路径
- 代码行数
- 当前状态
- 检测到的客户端特征
- 具体的优化建议

### 3. 正确的服务端组件
列出已经正确使用服务端组件的页面

### 4. 优化指南
- 服务端组件优先原则
- 重构步骤说明

## 示例输出

```markdown
# 前端页面组件分析报告

生成时间: 2025/12/10 09:37:48

## 📊 统计摘要

- 总页面数: 26
- 使用 "use client" 的页面: 11 (42.3%)
- 不必要的 "use client": 2 (可直接优化)
- 需要重构的页面: 9 (需拆分客户端组件)
- 正确的服务端组件: 15

## 🔴 高优先级优化 (可直接移除 "use client")

### app/dashboard/overview/page.tsx

- 行数: 26
- 状态: 包含 "use client" 但无客户端特征

**优化建议:**
- ✅ 可以移除 "use client" 声明，改为服务端组件
- 💡 服务端组件可以提升首屏加载速度和 SEO 性能
```

## 重构建议

### 对于高优先级页面

直接移除 `"use client"` 声明：

```typescript
// 之前
"use client";

export default function Page() {
  return <div>...</div>;
}

// 之后
export default function Page() {
  return <div>...</div>;
}
```

### 对于中优先级页面

将交互逻辑拆分到客户端组件：

**步骤 1**: 创建客户端组件
```typescript
// app/dashboard/overview/components/overview-client.tsx
"use client";

export function OverviewClient() {
  const [state, setState] = useState();
  // ... 客户端逻辑
  return <div>...</div>;
}
```

**步骤 2**: 在 page.tsx 中使用
```typescript
// app/dashboard/overview/page.tsx
import { OverviewClient } from './components/overview-client';

export default function OverviewPage() {
  return (
    <div>
      <h1>概览</h1>
      <OverviewClient />
    </div>
  );
}
```

## 注意事项

1. **误报可能性**: 脚本使用简单的字符串匹配，可能会有误报
2. **人工审查**: 建议在优化前人工审查分析结果
3. **测试验证**: 优化后务必进行功能测试
4. **渐进式优化**: 建议按优先级逐步优化，避免一次性改动过多

## 集成到 CI/CD

可以将此脚本集成到 CI/CD 流程中：

```yaml
# .github/workflows/code-quality.yml
- name: Analyze Server Components
  run: |
    cd frontend
    bun run analyze:server-components
```

## 相关文档

- [Next.js 服务端组件文档](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- [前端优化需求文档](../.kiro/specs/frontend-optimization/requirements.md)
- [前端优化设计文档](../.kiro/specs/frontend-optimization/design.md)

## 维护

如需添加新的客户端特征检测规则，请修改 `CLIENT_INDICATORS` 对象：

```typescript
const CLIENT_INDICATORS = {
  hooks: ['useState', 'useEffect', ...],
  events: ['onClick', 'onChange', ...],
  browserAPIs: ['window.', 'document.', ...],
};
```
