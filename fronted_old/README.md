# AI Higress Gateway - 前端项目

这是 AI Higress Gateway 的前端管理界面，基于 [Next.js](https://nextjs.org) App Router 构建，采用服务端组件优先架构。

## 技术栈

- **框架**: Next.js 15+ (App Router)
- **语言**: TypeScript 5+
- **样式**: Tailwind CSS + shadcn/ui
- **状态管理**: SWR (数据获取和缓存)
- **国际化**: 自定义 i18n 方案
- **包管理器**: bun

## 快速开始

### 安装依赖

```bash
bun install
```

### 开发环境

```bash
bun run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

### 生产构建

```bash
bun run build
bun run start
```

### 代码质量检查

```bash
# ESLint 检查
bun run lint

# TypeScript 类型检查
bun run type-check

# 代码质量综合检查
bash scripts/check-code-quality.sh
```

## 项目结构

```
frontend/
├── app/                          # Next.js App Router 页面
│   ├── (auth)/                   # 认证相关页面
│   ├── dashboard/                # 仪表盘页面
│   ├── profile/                  # 用户资料页面
│   ├── system/                   # 系统管理页面
│   └── layout.tsx                # 根布局
├── components/                   # 可复用组件
│   ├── ui/                       # shadcn/ui 基础组件
│   ├── dashboard/                # 仪表盘业务组件
│   ├── layout/                   # 布局组件
│   ├── forms/                    # 表单组件
│   └── ...                       # 其他功能域组件
├── lib/                          # 工具库和配置
│   ├── hooks/                    # 自定义 React Hooks
│   ├── i18n/                     # 国际化文案
│   ├── swr/                      # SWR 数据获取封装
│   ├── utils/                    # 工具函数
│   └── api-types.ts              # API 类型定义
├── http/                         # HTTP 客户端封装
└── docs/                         # 项目文档
```

## 架构设计

### 服务端组件优先

本项目采用 Next.js App Router 的服务端组件优先架构：

- **页面组件 (page.tsx)**: 默认为服务端组件，负责数据预取和页面布局
- **客户端组件**: 仅在需要交互、状态管理或浏览器 API 时使用，需显式声明 `"use client"`
- **组件拆分**: 将交互逻辑拆分到独立的客户端组件，保持页面组件简洁

### 数据获取策略

1. **服务端数据预取**: 在 page.tsx 中使用 async/await 预取初始数据
2. **客户端数据获取**: 使用 SWR 进行客户端数据获取和缓存
3. **缓存策略**: 根据数据更新频率选择合适的缓存策略
   - `static`: 很少变化的数据（如配置）
   - `frequent`: 频繁更新的数据（如指标）
   - `realtime`: 实时数据（如活动日志）

### 性能优化

- **代码分割**: 使用 `next/dynamic` 动态导入大型组件
- **图片优化**: 使用 Next.js Image 组件自动优化图片
- **虚拟滚动**: 长列表使用 `@tanstack/react-virtual` 实现虚拟滚动
- **React.memo**: 对纯展示组件使用 memo 避免不必要的重渲染

## 开发规范

### 组件开发

详见 [组件开发最佳实践](./docs/component-best-practices.md)

**核心原则**:
- 单一职责：每个组件只负责一个明确的功能
- 组件大小：单个组件不超过 200 行代码
- 类型安全：所有 Props 必须有完整的 TypeScript 类型定义
- 复用优先：优先使用 `@/components/ui` 中的 shadcn/ui 组件

### 命名规范

- **文件名**: kebab-case (如 `user-profile-card.tsx`)
- **组件名**: PascalCase (如 `UserProfileCard`)
- **函数/变量**: camelCase (如 `getUserData`)
- **常量**: UPPER_SNAKE_CASE (如 `API_BASE_URL`)

### 国际化 (i18n)

所有用户可见文案必须使用国际化：

```typescript
import { useI18n } from '@/lib/i18n-context';

function MyComponent() {
  const { t } = useI18n();
  
  return <h1>{t('common.welcome')}</h1>;
}
```

新增文案时，在 `lib/i18n/` 对应模块中添加中英文翻译。

### 数据获取

使用封装好的 SWR Hooks，不要直接使用 fetch：

```typescript
import { useApiGet } from '@/lib/swr/use-api';

function MyComponent() {
  const { data, error, isLoading } = useApiGet('/api/data', {
    cacheStrategy: 'frequent'
  });
  
  if (error) return <ErrorDisplay error={error} />;
  if (isLoading) return <LoadingSkeleton />;
  
  return <DataDisplay data={data} />;
}
```

## 性能优化方案

本项目已完成系统性的性能优化，主要包括：

### 1. 服务端组件迁移

所有主要页面已迁移为服务端组件优先架构：
- Dashboard Overview
- Dashboard Providers
- Dashboard API Keys
- Dashboard Credits
- Dashboard Metrics
- Profile
- System Admin
- System Roles

**优化效果**: 首屏加载时间减少 30-50%

### 2. 组件拆分

大型页面组件已拆分为小型、可复用的子组件：
- 单个组件不超过 200 行
- 遵循单一职责原则
- 提取可复用的共享组件

**优化效果**: 代码可维护性显著提升，组件复用率提高

### 3. 代码分割

使用 `next/dynamic` 对以下类型的组件进行动态导入：
- 图表组件（recharts）
- 对话框和抽屉组件
- 非首屏必需的大型组件

**优化效果**: 初始 bundle 大小减少 40%+

### 4. 数据获取优化

- 服务端数据预取：减少客户端请求
- SWR 缓存策略：避免重复请求
- 请求去重：自动合并相同请求

**优化效果**: 网络请求减少 50%+

### 5. 渲染优化

- 虚拟滚动：长列表性能提升
- React.memo：避免不必要的重渲染
- 图片优化：使用 Next.js Image 组件

**优化效果**: 渲染性能提升 60%+

详细的优化方案和实施记录，请参考：
- [性能优化总结](./docs/performance-optimization-summary.md)
- [代码分割策略](./docs/code-splitting-strategy.md)
- [Bundle 优化报告](./docs/bundle-optimization-report.md)

## 文档

- [组件开发最佳实践](./docs/component-best-practices.md)
- [性能优化指南](./docs/performance-optimization-summary.md)
- [代码分割策略](./docs/code-splitting-strategy.md)
- [TypeScript 类型指南](./docs/typescript-types-guide.md)
- [国际化完成报告](./docs/i18n-completion-summary.md)
- [UI 设计规范](../ui-prompt.md)

## 常见问题

### 如何添加新页面？

1. 在 `app/` 目录下创建新的路由文件夹
2. 创建 `page.tsx` 作为服务端组件
3. 如需交互，创建 `components/*-client.tsx` 客户端组件
4. 在 `lib/i18n/` 中添加对应的国际化文案

### 如何添加新的 UI 组件？

1. 优先使用 `@/components/ui` 中的 shadcn/ui 组件
2. 如需新组件，使用 `bunx shadcn@latest add <component-name>` 安装
3. 如需自定义组件，在 `components/` 对应功能域目录下创建

### 如何优化页面性能？

1. 确保页面使用服务端组件
2. 使用 `next/dynamic` 动态导入大型组件
3. 配置合适的 SWR 缓存策略
4. 长列表使用虚拟滚动
5. 使用 React.memo 优化纯展示组件

## 相关资源

- [Next.js 文档](https://nextjs.org/docs)
- [shadcn/ui 文档](https://ui.shadcn.com)
- [SWR 文档](https://swr.vercel.app)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

## 贡献指南

1. 遵循项目的代码规范和架构设计
2. 确保所有文案都已国际化
3. 添加必要的 TypeScript 类型定义
4. 运行代码质量检查确保无错误
5. 更新相关文档
