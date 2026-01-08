# 性能监控工具使用指南

本文档介绍如何使用性能监控工具函数和 Hooks 来测量和优化应用性能。

## 工具函数

### mark() - 创建性能标记

创建一个性能标记点，用于后续的性能测量。

```typescript
import { mark } from '@/lib/utils/performance';

mark('data-fetch-start');
// ... 执行数据获取
mark('data-fetch-end');
```

### measure() - 测量性能

测量两个标记之间的时间差。

```typescript
import { mark, measure } from '@/lib/utils/performance';

mark('operation-start');
// ... 执行操作
mark('operation-end');

const duration = measure('operation', 'operation-start', 'operation-end');
console.log(`Operation took ${duration}ms`);
```

### measureFunction() - 测量函数执行时间

自动测量函数的执行时间。

```typescript
import { measureFunction } from '@/lib/utils/performance';

const { result, duration } = await measureFunction(
  async () => {
    const response = await fetch('/api/data');
    return response.json();
  },
  'fetch-data'
);

console.log(`Data fetched in ${duration}ms`);
console.log('Result:', result);
```

### getMeasurements() - 获取性能测量结果

获取所有或特定的性能测量结果。

```typescript
import { getMeasurements } from '@/lib/utils/performance';

// 获取所有测量结果
const allMeasurements = getMeasurements();

// 获取特定名称的测量结果
const specificMeasurements = getMeasurements('data-fetch');

allMeasurements.forEach(m => {
  console.log(`${m.name}: ${m.duration}ms`);
});
```

### clearPerformance() - 清除性能数据

清除性能标记和测量数据。

```typescript
import { clearPerformance } from '@/lib/utils/performance';

// 清除所有性能数据
clearPerformance();

// 清除特定名称的性能数据
clearPerformance('data-fetch');
```

### reportWebVitals() - 报告 Web Vitals 指标

监控和报告核心 Web Vitals 指标。

```typescript
import { reportWebVitals } from '@/lib/utils/performance';

reportWebVitals((metrics) => {
  console.log('Performance metrics:', metrics);
  
  // 发送到分析服务
  if (metrics.lcp) {
    console.log('LCP:', metrics.lcp);
  }
  if (metrics.fcp) {
    console.log('FCP:', metrics.fcp);
  }
  if (metrics.fid) {
    console.log('FID:', metrics.fid);
  }
  if (metrics.cls) {
    console.log('CLS:', metrics.cls);
  }
});
```

### getPageLoadMetrics() - 获取页面加载指标

获取页面加载的各项性能指标。

```typescript
import { getPageLoadMetrics } from '@/lib/utils/performance';

const metrics = getPageLoadMetrics();
if (metrics) {
  console.log('DOM Content Loaded:', metrics.domContentLoaded);
  console.log('Load Complete:', metrics.loadComplete);
  console.log('First Paint:', metrics.firstPaint);
  console.log('First Contentful Paint:', metrics.firstContentfulPaint);
}
```

## React Hooks

### usePerformance() - 组件性能监控

自动测量组件的渲染性能。

```tsx
import { usePerformance } from '@/lib/hooks/use-performance';

function MyComponent() {
  usePerformance('MyComponent');
  
  return <div>Component content</div>;
}
```

可以通过第二个参数控制是否启用：

```tsx
function MyComponent({ enablePerfMonitoring = false }) {
  usePerformance('MyComponent', enablePerfMonitoring);
  
  return <div>Component content</div>;
}
```

### useMeasure() - 测量异步操作

测量组件内异步操作的性能。

```tsx
import { useMeasure } from '@/lib/hooks/use-performance';

function DataComponent() {
  const { start, end } = useMeasure('data-fetch');
  
  const fetchData = async () => {
    start();
    
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      
      const duration = end();
      console.log(`Fetch took ${duration}ms`);
      
      return data;
    } catch (error) {
      end(); // 确保即使出错也结束测量
      throw error;
    }
  };
  
  return (
    <button onClick={fetchData}>
      Fetch Data
    </button>
  );
}
```

### useMountTime() - 监控组件挂载时间

测量组件从开始渲染到挂载完成的时间。

```tsx
import { useMountTime } from '@/lib/hooks/use-performance';

function MyComponent() {
  useMountTime('MyComponent', (duration) => {
    console.log(`Component mounted in ${duration}ms`);
    
    // 可以发送到分析服务
    if (duration > 1000) {
      console.warn('Component took too long to mount!');
    }
  });
  
  return <div>Component content</div>;
}
```

### useUpdatePerformance() - 监控组件更新性能

测量组件更新的性能。

```tsx
import { useUpdatePerformance } from '@/lib/hooks/use-performance';

function MyComponent({ data, filter }) {
  useUpdatePerformance('MyComponent', [data, filter]);
  
  return (
    <div>
      {/* 组件内容 */}
    </div>
  );
}
```

## 使用场景

### 1. 监控数据获取性能

```tsx
import { useMeasure } from '@/lib/hooks/use-performance';

function DataTable() {
  const { start, end } = useMeasure('table-data-fetch');
  
  const { data, isLoading } = useSWR('/api/table-data', async (url) => {
    start();
    const response = await fetch(url);
    const data = await response.json();
    const duration = end();
    
    if (duration && duration > 2000) {
      console.warn('Data fetch took too long:', duration);
    }
    
    return data;
  });
  
  return <Table data={data} />;
}
```

### 2. 监控组件渲染性能

```tsx
import { usePerformance } from '@/lib/hooks/use-performance';

function HeavyComponent({ data }) {
  // 在开发环境启用性能监控
  usePerformance('HeavyComponent', process.env.NODE_ENV === 'development');
  
  // 复杂的渲染逻辑
  return (
    <div>
      {data.map(item => (
        <ComplexItem key={item.id} item={item} />
      ))}
    </div>
  );
}
```

### 3. 监控页面加载性能

```tsx
// app/layout.tsx
'use client';

import { useEffect } from 'react';
import { reportWebVitals, getPageLoadMetrics } from '@/lib/utils/performance';

export default function RootLayout({ children }) {
  useEffect(() => {
    // 报告 Web Vitals
    reportWebVitals((metrics) => {
      // 发送到分析服务
      console.log('Web Vitals:', metrics);
    });
    
    // 获取页面加载指标
    const loadMetrics = getPageLoadMetrics();
    if (loadMetrics) {
      console.log('Page Load Metrics:', loadMetrics);
    }
  }, []);
  
  return <html>{children}</html>;
}
```

### 4. 监控关键用户操作

```tsx
import { measureFunction } from '@/lib/utils/performance';

function FormComponent() {
  const handleSubmit = async (data) => {
    const { result, duration } = await measureFunction(
      async () => {
        const response = await fetch('/api/submit', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return response.json();
      },
      'form-submission'
    );
    
    console.log(`Form submitted in ${duration}ms`);
    
    // 如果提交时间过长，可以显示警告或优化
    if (duration > 3000) {
      console.warn('Form submission took too long');
    }
    
    return result;
  };
  
  return <form onSubmit={handleSubmit}>{/* 表单内容 */}</form>;
}
```

## 性能优化建议

### 1. 识别性能瓶颈

使用性能监控工具识别慢速操作：

```tsx
function DashboardPage() {
  const { start: startStats, end: endStats } = useMeasure('stats-fetch');
  const { start: startCharts, end: endCharts } = useMeasure('charts-fetch');
  
  const { data: stats } = useSWR('/api/stats', async (url) => {
    startStats();
    const data = await fetch(url).then(r => r.json());
    const duration = endStats();
    console.log(`Stats loaded in ${duration}ms`);
    return data;
  });
  
  const { data: charts } = useSWR('/api/charts', async (url) => {
    startCharts();
    const data = await fetch(url).then(r => r.json());
    const duration = endCharts();
    console.log(`Charts loaded in ${duration}ms`);
    return data;
  });
  
  // 根据测量结果决定优化策略
}
```

### 2. 设置性能预算

```tsx
const PERFORMANCE_BUDGET = {
  componentMount: 100, // 组件挂载不超过 100ms
  dataFetch: 2000,     // 数据获取不超过 2s
  render: 16,          // 单次渲染不超过 16ms (60fps)
};

function MonitoredComponent() {
  useMountTime('MonitoredComponent', (duration) => {
    if (duration > PERFORMANCE_BUDGET.componentMount) {
      console.warn(
        `Component mount exceeded budget: ${duration}ms > ${PERFORMANCE_BUDGET.componentMount}ms`
      );
    }
  });
  
  return <div>Content</div>;
}
```

### 3. 生产环境监控

```tsx
// lib/analytics.ts
import { reportWebVitals } from '@/lib/utils/performance';

export function initPerformanceMonitoring() {
  if (process.env.NODE_ENV === 'production') {
    reportWebVitals((metrics) => {
      // 发送到分析服务（如 Google Analytics, Vercel Analytics 等）
      if (window.gtag) {
        Object.entries(metrics).forEach(([key, value]) => {
          if (value !== undefined) {
            window.gtag('event', key, {
              value: Math.round(value),
              metric_id: key,
            });
          }
        });
      }
    });
  }
}
```

## 最佳实践

1. **开发环境启用详细日志**：在开发时启用性能监控，生产环境只记录关键指标
2. **设置性能预算**：为关键操作设置性能预算，超出时发出警告
3. **持续监控**：定期检查性能指标，及时发现性能退化
4. **优先优化瓶颈**：使用测量数据识别真正的性能瓶颈，而不是盲目优化
5. **避免过度测量**：不要在每个组件都添加性能监控，只监控关键路径
6. **清理性能数据**：定期清理不需要的性能标记和测量，避免内存泄漏

## 注意事项

1. 性能监控本身也有开销，不要在生产环境过度使用
2. 某些浏览器可能不支持所有的 Performance API
3. 性能指标会受到用户设备、网络等因素影响，需要收集足够的样本
4. 使用 `try-catch` 包裹性能监控代码，避免影响正常功能
