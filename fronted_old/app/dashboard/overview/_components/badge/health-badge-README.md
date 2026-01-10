# 健康状态徽章组件 (HealthBadge)

## 概述

健康状态徽章组件根据错误率和 P95 延迟自动推导系统健康状态，并以不同颜色的徽章形式展示。

## 功能特性

- ✅ 自动推导健康状态（正常/抖动/异常）
- ✅ 三种状态样式（绿色/黄色/红色）
- ✅ 支持加载状态
- ✅ 支持暗色模式
- ✅ 国际化支持

## 健康状态判断规则

### 正常（绿色）
- 错误率 < 1%
- **且** P95 延迟 < 1000ms

### 抖动（黄色）
- 错误率在 1-5%
- **或** P95 延迟在 1000-3000ms

### 异常（红色）
- 错误率 > 5%
- **或** P95 延迟 > 3000ms

## 使用示例

### 基本使用

```tsx
import { HealthBadge } from "@/app/dashboard/overview/_components";

function MyComponent() {
  return (
    <HealthBadge 
      errorRate={0.5} 
      latencyP95Ms={800} 
    />
  );
}
```

### 加载状态

```tsx
<HealthBadge 
  errorRate={0} 
  latencyP95Ms={0} 
  isLoading={true} 
/>
```

### 自定义样式

```tsx
<HealthBadge 
  errorRate={2} 
  latencyP95Ms={1500} 
  className="ml-4" 
/>
```

### 与 KPI 数据集成

```tsx
import { useUserDashboardKPIs } from "@/lib/swr/use-dashboard-v2";
import { HealthBadge } from "@/app/dashboard/overview/_components";

function DashboardHeader() {
  const { data, isLoading } = useUserDashboardKPIs({
    timeRange: "7d",
    transport: "all",
    isStream: "all",
  });

  return (
    <div className="flex items-center gap-4">
      <h1>Dashboard Overview</h1>
      <HealthBadge
        errorRate={data?.error_rate ?? 0}
        latencyP95Ms={data?.latency_p95_ms ?? 0}
        isLoading={isLoading}
      />
    </div>
  );
}
```

## Props

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `errorRate` | `number` | ✅ | - | 错误率（0-100 的百分比） |
| `latencyP95Ms` | `number` | ✅ | - | P95 延迟（毫秒） |
| `isLoading` | `boolean` | ❌ | `false` | 是否正在加载 |
| `className` | `string` | ❌ | - | 自定义类名 |

## 类型定义

```typescript
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthBadgeProps {
  errorRate: number;
  latencyP95Ms: number;
  isLoading?: boolean;
  className?: string;
}
```

## 国际化

组件使用 `useI18n()` Hook 获取文案，支持中英文：

- `dashboardV2.healthBadge.loading` - 加载中
- `dashboardV2.healthBadge.healthy` - 正常
- `dashboardV2.healthBadge.degraded` - 抖动
- `dashboardV2.healthBadge.unhealthy` - 异常

## 样式说明

组件使用 Tailwind CSS 类名，自动适配亮色和暗色模式：

- **正常**：`bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`
- **抖动**：`bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`
- **异常**：`bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`

## 演示

运行演示页面查看所有状态：

```bash
# 访问演示页面
http://localhost:3000/dashboard/overview/health-badge-demo
```

## 验证需求

该组件实现了以下需求：

- ✅ 需求 10.1：在页面顶部显示健康状态徽章
- ✅ 需求 10.2：错误率 < 1% 且 P95 延迟 < 1000ms 显示绿色"正常"
- ✅ 需求 10.3：错误率在 1-5% 或 P95 延迟明显升高显示黄色"抖动"
- ✅ 需求 10.4：错误率 > 5% 或超时大量出现显示红色"异常"

## 相关组件

- `FilterBar` - 筛选器组件
- `TotalRequestsCard` - 总请求数卡片
- `ErrorRateCard` - 错误率卡片
- `LatencyP95Card` - P95 延迟卡片
