# 服务端预取快速参考

## 🚀 快速开始

### 1. 将 page.tsx 改为 async 服务端组件

```typescript
// ❌ 之前
export default function MyPage() {
  return <MyClient />;
}

// ✅ 现在
export default async function MyPage() {
  return <MyClient />;
}
```

### 2. 预取数据并传递 fallback

```typescript
import { SWRProvider } from "@/lib/swr/provider";
import { serverFetch } from "@/lib/swr/server-fetch";

export default async function MyPage() {
  // 预取数据
  const data = await serverFetch('/api/my-data');
  
  // 传递给客户端
  return (
    <SWRProvider fallback={{ '/api/my-data': data }}>
      <MyClient />
    </SWRProvider>
  );
}
```

### 3. 客户端组件正常使用 SWR

```typescript
"use client";

export function MyClient() {
  const { data } = useMyData(); // 使用现有的 SWR hook
  
  // 首次渲染直接使用 fallback 数据，无闪烁
  return <div>{data?.value}</div>;
}
```

## 📋 常见场景

### 场景 1: 详情页（有 URL 参数）

```typescript
export default async function ItemPage({ params }) {
  const { id } = await params;
  const item = await serverFetch(`/api/items/${id}`);
  
  return (
    <SWRProvider fallback={{ [`/api/items/${id}`]: item }}>
      <ItemDetail id={id} />
    </SWRProvider>
  );
}
```

### 场景 2: 列表页（带查询参数）

```typescript
export default async function ListPage() {
  const queryParams = { page: '1', limit: '20' };
  const key = `/api/items?${new URLSearchParams(queryParams)}`;
  const items = await serverFetch(key);
  
  return (
    <SWRProvider fallback={{ [key]: items }}>
      <ItemList />
    </SWRProvider>
  );
}
```

### 场景 3: Dashboard（多个数据源）

```typescript
export default async function DashboardPage() {
  const [stats, users, orders] = await Promise.all([
    serverFetch('/api/stats'),
    serverFetch('/api/users?limit=10'),
    serverFetch('/api/orders?status=pending'),
  ]);
  
  return (
    <SWRProvider
      fallback={{
        '/api/stats': stats,
        '/api/users?limit=10': users,
        '/api/orders?status=pending': orders,
      }}
    >
      <DashboardClient />
    </SWRProvider>
  );
}
```

### 场景 4: 依赖客户端状态（不预取）

```typescript
// 数据依赖 Zustand store 或 localStorage
export default async function MyPage() {
  return (
    <SWRProvider fallback={{}}>
      <MyClient />
    </SWRProvider>
  );
}
```

## ⚠️ 关键注意事项

### 1. SWR Key 必须完全匹配

```typescript
// ❌ 错误：key 不匹配
// 服务端
fallback: { '/api/data': data }
// 客户端
useSWR('/api/data?foo=bar', fetcher)

// ✅ 正确：key 完全匹配
// 服务端
const key = '/api/data?foo=bar';
fallback: { [key]: data }
// 客户端
useSWR('/api/data?foo=bar', fetcher)
```

### 2. 使用辅助函数构建 key

```typescript
function buildSWRKey(endpoint: string, params: Record<string, string>): string {
  return `${endpoint}?${new URLSearchParams(params).toString()}`;
}

// 使用
const key = buildSWRKey('/api/items', { page: '1', limit: '20' });
const data = await serverFetch(key);
```

### 3. 处理认证

```typescript
// serverFetch 自动从 cookies 获取 token
const data = await serverFetch('/api/protected');

// 如果未登录，返回 null
// 客户端会重新请求
```

### 4. 并行预取

```typescript
// ✅ 推荐：并行预取
const [data1, data2] = await Promise.all([
  serverFetch('/api/endpoint1'),
  serverFetch('/api/endpoint2'),
]);

// ❌ 避免：串行预取
const data1 = await serverFetch('/api/endpoint1');
const data2 = await serverFetch('/api/endpoint2');
```

## 🎯 何时使用

### ✅ 适合预取的场景

- 页面有明确的 URL 参数（如 ID）
- 数据不依赖客户端状态
- 数据对首屏渲染很重要
- 数据量适中

### ❌ 不适合预取的场景

- 数据依赖客户端状态（Zustand、localStorage）
- 数据需要实时更新
- 数据量很大
- 数据不重要（如统计、分析）

## 🔧 调试技巧

### 1. 检查 SWR key 是否匹配

```typescript
// 在服务端打印 key
console.log('[Server] SWR key:', key);

// 在客户端 SWR hook 中打印 key
console.log('[Client] SWR key:', key);
```

### 2. 检查 fallback 数据

```typescript
// 在 SWRProvider 中打印 fallback
console.log('[Server] Fallback:', fallback);
```

### 3. 使用 React DevTools

- 查看 SWRConfig 的 props
- 确认 fallback 数据已传递

### 4. 使用 Network 面板

- 确认没有重复的客户端请求
- 首屏应该只有服务端请求

## 📚 相关文档

- 完整指南: `frontend/lib/swr/SERVER_PREFETCH_GUIDE.md`
- 实现总结: `frontend/lib/swr/IMPLEMENTATION_SUMMARY.md`
- SWR 官方文档: https://swr.vercel.app/docs/with-nextjs
