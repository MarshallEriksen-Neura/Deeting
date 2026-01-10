# Dashboard v2 用户页组件

本目录包含 Dashboard v2 用户页的所有组件实现。

## 组件列表

### KPI 卡片组件

所有 KPI 卡片组件都遵循统一的接口设计，支持加载态、错误态和正常数据显示。

#### 1. TotalRequestsCard - 总请求数卡片

显示总请求数指标。

```tsx
import { TotalRequestsCard } from "@/app/dashboard/overview/_components";

<TotalRequestsCard
  value={125430}
  isLoading={false}
  error={undefined}
/>
```

**Props:**
- `value: number` - 总请求数
- `isLoading: boolean` - 是否加载中
- `error?: Error` - 错误对象（可选）

#### 2. CreditsSpentCard - Credits 花费卡片

显示 Credits 花费指标，自动格式化为两位小数。

```tsx
import { CreditsSpentCard } from "@/app/dashboard/overview/_components";

<CreditsSpentCard
  value={1234.56}
  isLoading={false}
  error={undefined}
/>
```

**Props:**
- `value: number` - Credits 花费金额
- `isLoading: boolean` - 是否加载中
- `error?: Error` - 错误对象（可选）

#### 3. LatencyP95Card - P95 延迟卡片

显示 P95 延迟指标，自动添加 "ms" 单位。

```tsx
import { LatencyP95Card } from "@/app/dashboard/overview/_components";

<LatencyP95Card
  value={856}
  isLoading={false}
  error={undefined}
/>
```

**Props:**
- `value: number` - P95 延迟（毫秒）
- `isLoading: boolean` - 是否加载中
- `error?: Error` - 错误对象（可选）

#### 4. ErrorRateCard - 错误率卡片

显示错误率指标，根据错误率高低自动显示不同颜色：
- < 1%: 绿色（正常）
- 1-5%: 黄色（警告）
- > 5%: 红色（异常）

```tsx
import { ErrorRateCard } from "@/app/dashboard/overview/_components";

<ErrorRateCard
  value={0.0234}  // 2.34%
  isLoading={false}
  error={undefined}
/>
```

**Props:**
- `value: number` - 错误率（0-1 之间的小数）
- `isLoading: boolean` - 是否加载中
- `error?: Error` - 错误对象（可选）

#### 5. TotalTokensCard - Token 总量卡片

显示 Token 总量指标，同时显示输入和输出 Token 的详细信息。

```tsx
import { TotalTokensCard } from "@/app/dashboard/overview/_components";

<TotalTokensCard
  inputTokens={1234567}
  outputTokens={987654}
  totalTokens={2222221}
  isLoading={false}
  error={undefined}
/>
```

**Props:**
- `inputTokens: number` - 输入 Token 数量
- `outputTokens: number` - 输出 Token 数量
- `totalTokens: number` - Token 总量
- `isLoading: boolean` - 是否加载中
- `error?: Error` - 错误对象（可选）

### 筛选器组件

#### FilterBar - 筛选器栏

提供时间范围、传输方式和流式筛选功能。

```tsx
import { FilterBar } from "@/app/dashboard/overview/_components";

<FilterBar
  timeRange="7d"
  transport="all"
  isStream="all"
  onTimeRangeChange={(range) => console.log(range)}
  onTransportChange={(transport) => console.log(transport)}
  onStreamChange={(stream) => console.log(stream)}
/>
```

**Props:**
- `timeRange: TimeRange` - 时间范围（"today" | "7d" | "30d"）
- `transport: Transport` - 传输方式（"all" | "http" | "sdk" | "claude_cli"）
- `isStream: StreamFilter` - 流式筛选（"all" | "true" | "false"）
- `onTimeRangeChange: (range: TimeRange) => void` - 时间范围变化回调
- `onTransportChange: (transport: Transport) => void` - 传输方式变化回调
- `onStreamChange: (stream: StreamFilter) => void` - 流式筛选变化回调

## 使用示例

### 完整的 KPI 卡片网格

```tsx
"use client";

import { useUserDashboardKPIs } from "@/lib/swr/use-dashboard-v2";
import {
  TotalRequestsCard,
  CreditsSpentCard,
  LatencyP95Card,
  ErrorRateCard,
  TotalTokensCard,
} from "@/app/dashboard/overview/_components";

export function KPICardsGrid() {
  const { data, loading, error } = useUserDashboardKPIs({
    timeRange: "7d",
    transport: "all",
    isStream: "all",
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <TotalRequestsCard
        value={data?.total_requests ?? 0}
        isLoading={loading}
        error={error}
      />
      <CreditsSpentCard
        value={data?.credits_spent ?? 0}
        isLoading={loading}
        error={error}
      />
      <LatencyP95Card
        value={data?.latency_p95_ms ?? 0}
        isLoading={loading}
        error={error}
      />
      <ErrorRateCard
        value={data?.error_rate ?? 0}
        isLoading={loading}
        error={error}
      />
      <TotalTokensCard
        inputTokens={data?.tokens.input ?? 0}
        outputTokens={data?.tokens.output ?? 0}
        totalTokens={data?.tokens.total ?? 0}
        isLoading={loading}
        error={error}
      />
    </div>
  );
}
```

## 设计原则

1. **统一接口**：所有 KPI 卡片都遵循相同的 Props 接口（value, isLoading, error）
2. **加载态优先**：使用 Skeleton 组件避免布局抖动
3. **错误处理**：优雅地显示错误信息，不阻塞其他卡片
4. **国际化**：所有文案通过 `useI18n()` Hook 获取
5. **主题适配**：使用 AdaptiveCard 自动适配所有主题
6. **响应式**：卡片在不同屏幕尺寸下自动调整布局

## 验证需求

- **需求 1.1**：显示 5 张 KPI 卡片
- **需求 1.3**：正确显示 Credits 花费
- **需求 1.4**：Token 卡片显示输入和输出 Token
- **需求 1.5**：加载态显示 Skeleton 占位符

## 测试

运行演示页面查看所有卡片的不同状态：

```bash
# 在浏览器中访问
http://localhost:3000/dashboard/overview
```

演示组件位于 `kpi-cards-demo.tsx`，可以切换加载态和错误态进行测试。
