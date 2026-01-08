# Dashboard v2 Filter Bar Component

## 概述

`FilterBar` 组件为 Dashboard v2 用户页提供筛选功能，支持时间范围、传输方式和流式筛选。

## 功能特性

### 1. 时间范围筛选（Time Range）
- **选项**：`today`、`7d`、`30d`
- **默认值**：`7d`
- **用途**：控制 KPI 卡片、Token 趋势、成本结构、Top Models 的数据时间范围
- **注意**：Pulse 图表（近 24h）不受时间范围影响

### 2. 传输方式筛选（Transport）
- **选项**：`all`、`http`、`sdk`、`claude_cli`
- **默认值**：`all`
- **用途**：按传输方式过滤所有图表和卡片数据

### 3. 流式筛选（Stream）
- **选项**：`all`、`true`、`false`
- **默认值**：`all`
- **用途**：按是否流式请求过滤所有图表和卡片数据

## 使用方法

```tsx
import { FilterBar, TimeRange, Transport, StreamFilter } from "@/components/dashboard/v2/filters/filter-bar";

function MyDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [transport, setTransport] = useState<Transport>("all");
  const [isStream, setIsStream] = useState<StreamFilter>("all");

  return (
    <FilterBar
      timeRange={timeRange}
      transport={transport}
      isStream={isStream}
      onTimeRangeChange={setTimeRange}
      onTransportChange={setTransport}
      onStreamChange={setIsStream}
    />
  );
}
```

## 组件接口

### Props

```typescript
interface FilterBarProps {
  timeRange: TimeRange;           // 当前时间范围
  transport: Transport;            // 当前传输方式
  isStream: StreamFilter;          // 当前流式筛选
  onTimeRangeChange: (range: TimeRange) => void;      // 时间范围变化回调
  onTransportChange: (transport: Transport) => void;  // 传输方式变化回调
  onStreamChange: (stream: StreamFilter) => void;     // 流式筛选变化回调
}
```

### 类型定义

```typescript
type TimeRange = "today" | "7d" | "30d";
type Transport = "all" | "http" | "sdk" | "claude_cli";
type StreamFilter = "all" | "true" | "false";
```

## 国际化支持

组件使用 `useI18n()` Hook 获取多语言文案，所有文案 key 定义在 `frontend/lib/i18n/dashboard-v2.ts` 中：

- `dashboard_v2.filter.time_range.label`
- `dashboard_v2.filter.time_range.today`
- `dashboard_v2.filter.time_range.7d`
- `dashboard_v2.filter.time_range.30d`
- `dashboard_v2.filter.transport.label`
- `dashboard_v2.filter.transport.all`
- `dashboard_v2.filter.transport.http`
- `dashboard_v2.filter.transport.sdk`
- `dashboard_v2.filter.transport.claude_cli`
- `dashboard_v2.filter.stream.label`
- `dashboard_v2.filter.stream.all`
- `dashboard_v2.filter.stream.true`
- `dashboard_v2.filter.stream.false`

## 验证需求

该组件满足以下需求：

- **需求 7.1**：在页面顶部显示时间范围筛选器，支持 `today`、`7d`、`30d` 三个选项
- **需求 7.4**：页面首次加载时默认选择 `7d` 时间范围（由父组件控制）
- **需求 8.1**：在页面顶部显示传输方式筛选器，支持 `all`、`http`、`sdk`、`claude_cli` 选项
- **需求 8.2**：在页面顶部显示流式筛选器，支持 `all`、`true`、`false` 选项

## 技术实现

### 客户端水合处理

组件使用 `isHydrated` 状态避免服务端渲染和客户端渲染不一致导致的水合错误：

```typescript
const [isHydrated, setIsHydrated] = useState(false);

useEffect(() => {
  setIsHydrated(true);
}, []);

if (!isHydrated) {
  return <LoadingSkeleton />;
}
```

### 输入验证

组件提供三个验证函数确保筛选器值的有效性：

- `isValidTimeRange(value)` - 验证时间范围值
- `isValidTransport(value)` - 验证传输方式值
- `isValidStreamFilter(value)` - 验证流式筛选值

### 响应式设计

组件使用 `flex-wrap` 确保在小屏幕上自动换行，保持良好的移动端体验。

## 测试

可以使用 `FilterBarDemo` 组件测试筛选器功能：

```tsx
import { FilterBarDemo } from "@/components/dashboard/v2/filters/filter-bar-demo";

// 在页面中使用
<FilterBarDemo />
```

## 依赖

- `@/components/ui/select` - shadcn/ui Select 组件
- `@/lib/i18n-context` - 国际化 Hook
- React 18+ - 使用 `useState` 和 `useEffect`
