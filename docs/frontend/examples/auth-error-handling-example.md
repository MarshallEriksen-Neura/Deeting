# 认证错误处理示例

本文档提供实际的代码示例，展示如何正确处理认证错误。

## 示例 1: 需要认证的仪表盘页面

```typescript
// frontend/app/dashboard/overview/page.tsx
'use client';

import { useApiGet } from '@/lib/swr/hooks';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { tokenManager } from '@/lib/auth/token-manager';

export default function OverviewPage() {
  const router = useRouter();
  
  // 检查登录状态
  useEffect(() => {
    if (!tokenManager.getAccessToken()) {
      router.push('/auth/login');
    }
  }, [router]);
  
  // 默认需要认证，未登录时不会发起请求
  const { data: metrics, error, loading } = useApiGet('/metrics/overview/summary');
  const { data: providers } = useApiGet('/metrics/overview/providers');
  const { data: events } = useApiGet('/metrics/overview/events');
  
  if (loading) return <div>加载中...</div>;
  if (error) return <div>加载失败</div>;
  
  return (
    <div>
      <h1>概览</h1>
      {/* 渲染数据 */}
    </div>
  );
}
```

**说明**：
- 使用 `useEffect` 在客户端检查登录状态
- 未登录时跳转到登录页
- 所有 `useApiGet` 默认需要认证，未登录时不会发起请求
- 避免了多个 401 错误

## 示例 2: 混合公开和私有数据的页面

```typescript
// frontend/app/home/page.tsx
'use client';

import { useApiGet } from '@/lib/swr/hooks';
import { tokenManager } from '@/lib/auth/token-manager';

export default function HomePage() {
  const isLoggedIn = !!tokenManager.getAccessToken();
  
  // 公开数据，不需要认证
  const { data: publicConfig } = useApiGet('/system/public-config', {
    requireAuth: false
  });
  
  // 用户数据，需要认证
  const { data: userProfile } = useApiGet(
    isLoggedIn ? '/auth/me' : null,
    { requireAuth: true }
  );
  
  return (
    <div>
      <h1>欢迎使用 {publicConfig?.appName}</h1>
      {isLoggedIn && userProfile && (
        <p>你好，{userProfile.display_name}</p>
      )}
      {!isLoggedIn && (
        <a href="/auth/login">登录</a>
      )}
    </div>
  );
}
```

**说明**：
- 公开配置使用 `requireAuth: false`，即使未登录也会请求
- 用户数据根据登录状态决定是否请求
- 避免未登录时发起无效的认证请求

## 示例 3: 使用认证错误回调

```typescript
// frontend/app/layout.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAuthErrorCallback, clearAuthErrorCallback } from '@/http/client';
import { SWRProvider } from '@/lib/swr';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  useEffect(() => {
    // 设置认证错误回调
    setAuthErrorCallback(() => {
      console.log('[Auth] Token expired or invalid, redirecting to login...');
      router.push('/auth/login?expired=true');
    });
    
    // 清理
    return () => {
      clearAuthErrorCallback();
    };
  }, [router]);
  
  return (
    <html>
      <body>
        <SWRProvider>
          {children}
        </SWRProvider>
      </body>
    </html>
  );
}
```

**说明**：
- 在根布局中设置全局认证错误回调
- 当 token 刷新失败时，自动跳转到登录页
- 防重复机制确保不会多次跳转

## 示例 4: 自定义错误处理

```typescript
// frontend/components/dashboard/user-profile.tsx
'use client';

import { useApiGet } from '@/lib/swr/hooks';
import { useErrorDisplay } from '@/lib/errors';
import { Alert } from '@/components/ui/alert';

export function UserProfile() {
  const { data, error, loading } = useApiGet('/auth/me');
  
  // 使用统一的错误展示
  useErrorDisplay(error);
  
  if (loading) {
    return <div>加载中...</div>;
  }
  
  if (error) {
    // 401 错误已由全局处理，这里只处理其他错误
    if (error.status !== 401) {
      return (
        <Alert variant="destructive">
          加载用户信息失败：{error.message}
        </Alert>
      );
    }
    return null; // 401 错误不显示，等待跳转
  }
  
  return (
    <div>
      <h2>{data.display_name}</h2>
      <p>{data.email}</p>
    </div>
  );
}
```

**说明**：
- 使用 `useErrorDisplay` 统一处理错误展示
- 401 错误由全局处理，组件中不需要额外处理
- 其他错误可以自定义展示方式

## 示例 5: 分页列表的认证处理

```typescript
// frontend/app/dashboard/orders/page.tsx
'use client';

import { usePaginatedData } from '@/lib/swr/hooks';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { tokenManager } from '@/lib/auth/token-manager';

export default function OrdersPage() {
  const router = useRouter();
  
  // 检查登录状态
  useEffect(() => {
    if (!tokenManager.getAccessToken()) {
      router.push('/auth/login');
    }
  }, [router]);
  
  // 分页数据，默认需要认证
  const {
    data,
    total,
    loading,
    currentPage,
    setPage,
    hasNextPage,
    hasPreviousPage
  } = usePaginatedData('/api/orders', {
    params: { status: 'active' }
  });
  
  if (loading) return <div>加载中...</div>;
  
  return (
    <div>
      <h1>订单列表 (共 {total} 条)</h1>
      <ul>
        {data.map(order => (
          <li key={order.id}>{order.name}</li>
        ))}
      </ul>
      <div>
        <button 
          disabled={!hasPreviousPage}
          onClick={() => setPage(currentPage - 1)}
        >
          上一页
        </button>
        <span>第 {currentPage} 页</span>
        <button 
          disabled={!hasNextPage}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
```

**说明**：
- 使用 `usePaginatedData` 处理分页数据
- 默认需要认证，未登录时不会发起请求
- 分页切换时也会自动检查认证状态

## 示例 6: 搜索功能的认证处理

```typescript
// frontend/app/search/page.tsx
'use client';

import { useSearchData } from '@/lib/swr/hooks';
import { Input } from '@/components/ui/input';

export default function SearchPage() {
  // 公开搜索，不需要认证
  const {
    data,
    count,
    loading,
    searchTerm,
    setSearchTerm
  } = useSearchData('/api/public/search', {
    requireAuth: false
  });
  
  return (
    <div>
      <h1>搜索</h1>
      <Input
        type="text"
        placeholder="输入搜索关键词..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      {loading && <div>搜索中...</div>}
      <div>找到 {count} 条结果</div>
      <ul>
        {data.map(item => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

**说明**：
- 公开搜索使用 `requireAuth: false`
- 即使未登录也可以搜索
- 防抖机制避免频繁请求

## 常见问题

### Q: 为什么我的请求没有发起？

A: 检查以下几点：
1. 是否已登录（`tokenManager.getAccessToken()` 返回值）
2. 是否设置了 `requireAuth: false`（如果是公开 API）
3. URL 是否为 `null`（条件请求）

### Q: 如何处理 token 过期？

A: token 过期会自动触发刷新流程：
1. axios 拦截器捕获 401 错误
2. 尝试使用 refresh token 刷新
3. 刷新成功后重试原请求
4. 刷新失败则清除 token 并跳转登录页

### Q: 如何避免重复的 401 错误？

A: 系统已实现三层防护：
1. **HTTP Client 层**：防重复触发认证错误回调
2. **SWR Provider 层**：401 错误不重试
3. **SWR Hooks 层**：未登录时跳过请求

### Q: 公开 API 和私有 API 如何区分？

A: 使用 `requireAuth` 选项：
```typescript
// 私有 API（默认）
useApiGet('/api/user/profile')

// 公开 API
useApiGet('/api/public/config', { requireAuth: false })
```

## 调试技巧

### 1. 查看认证状态

```typescript
import { tokenManager } from '@/lib/auth/token-manager';

console.log('Access Token:', tokenManager.getAccessToken());
console.log('Refresh Token:', tokenManager.getRefreshToken());
```

### 2. 监听认证错误

```typescript
import { setAuthErrorCallback } from '@/http/client';

setAuthErrorCallback(() => {
  console.log('[Auth Error] Token expired or invalid');
  // 自定义处理逻辑
});
```

### 3. 查看 SWR 缓存

```typescript
import { useSWRConfig } from 'swr';

function DebugComponent() {
  const { cache } = useSWRConfig();
  console.log('SWR Cache:', cache);
  return null;
}
```

### 4. 开启详细日志

在浏览器控制台中查看：
- `[Auth Debug]` - 认证相关日志
- `[SWR]` - SWR 相关日志
- `[HTTP Error]` - HTTP 错误日志

## 相关文档

- [认证错误处理机制](../auth-error-handling.md) - 详细的技术文档
- [SWR 使用指南](../swr-guide.md) - SWR 最佳实践
- [错误处理改进方案](../error-handling-improvement-plan.md) - 错误处理设计
