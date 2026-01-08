# SWR 封装库

这个库为前端应用提供了 SWR (Stale-While-Revalidate) 的完整封装，包括 fetcher 函数、Provider 组件、缓存管理和自定义 Hooks。

## 文件结构

```
lib/swr/
├── fetcher.ts    # SWR fetcher 函数，封装了各种 HTTP 方法
├── provider.tsx  # SWR Provider 组件，提供全局 SWR 配置
├── cache.ts      # 缓存管理工具和策略
├── hooks.ts      # 自定义 SWR Hooks
└── index.ts      # 统一导出
```

## 安装和使用

### 1. 在应用根部设置 Provider

```tsx
import { SWRProvider } from '@/lib/swr';

function App({ Component, pageProps }: AppProps) {
  return (
    <SWRProvider>
      <Component {...pageProps} />
    </SWRProvider>
  );
}
```

### 2. 使用自定义 Hooks

#### 基础 GET 请求

```tsx
import { useApiGet } from '@/lib/swr';

function UserList() {
  const { data: users, error, loading } = useApiGet<User[]>('/users');
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <ul>
      {users.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}
```

#### 使用缓存策略

```tsx
import { useApiGet } from '@/lib/swr';

// 使用频繁更新策略 (30秒自动刷新)
const { data, loading } = useApiGet<Notifications[]>('/notifications', {
  strategy: 'frequent'
});

// 使用实时策略 (5秒自动刷新)
const { data: liveData } = useApiGet<LiveData[]>('/live-data', {
  strategy: 'realtime'
});
```

#### 带参数的 GET 请求

```tsx
import { useApiGet } from '@/lib/swr';

function FilteredList({ category, search }) {
  const { data: items } = useApiGet<Item[]>('/items', {
    params: { category, search }
  });
  
  return (
    <div>
      {items.map(item => <div key={item.id}>{item.name}</div>)}
    </div>
  );
}
```

#### 使用 Mutation Hooks

```tsx
import { useApiPost } from '@/lib/swr';

function CreateUserForm() {
  const { trigger, submitting, error } = useApiPost<User, CreateUserRequest>('/users');
  
  const handleSubmit = async (userData: CreateUserRequest) => {
    try {
      const newUser = await trigger(userData);
      console.log('User created:', newUser);
    } catch (err) {
      console.error('Failed to create user:', err);
    }
  };
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      handleSubmit(Object.fromEntries(formData.entries()) as CreateUserRequest);
    }}>
      {/* Form fields */}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create User'}
      </button>
      {error && <div>Error: {error.message}</div>}
    </form>
  );
}
```

#### 分页数据

```tsx
import { usePaginatedData } from '@/lib/swr';

function PaginatedUserList() {
  const {
    data: users,
    loading,
    currentPage,
    pageSize,
    total,
    setPage,
    hasNextPage,
    hasPreviousPage
  } = usePaginatedData<User>('/users');
  
  return (
    <div>
      <div>
        {users.map(user => <div key={user.id}>{user.name}</div>)}
      </div>
      
      <div>
        <button 
          disabled={!hasPreviousPage}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous
        </button>
        <span>Page {currentPage}</span>
        <button 
          disabled={!hasNextPage}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </div>
      
      <div>Total: {total} items</div>
    </div>
  );
}
```

#### 搜索数据

```tsx
import { useSearchData } from '@/lib/swr';

function SearchUsers() {
  const {
    data: users,
    loading,
    searchTerm,
    setSearchTerm
  } = useSearchData<User>('/users');
  
  return (
    <div>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search users..."
      />
      
      <div>
        {loading && <div>Searching...</div>}
        {users.map(user => <div key={user.id}>{user.name}</div>)}
      </div>
    </div>
  );
}
```

#### 资源管理 (CRUD)

```tsx
import { useResource } from '@/lib/swr';

function UserManagement() {
  const {
    data: users,
    createResource,
    updateResource,
    deleteResource,
    creating,
    updating,
    deleting
  } = useResource<User, CreateUserRequest>('/users');
  
  const handleCreate = async (userData: CreateUserRequest) => {
    await createResource(userData);
  };
  
  const handleUpdate = async (id: string, userData: Partial<User>) => {
    await updateResource(id, userData);
  };
  
  const handleDelete = async (id: string) => {
    await deleteResource(id);
  };
  
  return (
    <div>
      {/* UI for user management */}
    </div>
  );
}
```

#### 缓存管理

```tsx
import { useSWRCache } from '@/lib/swr';

function CacheManagement() {
  const { cacheManager, refreshCacheByPattern } = useSWRCache();
  
  // 清除所有以 '/users' 开头的缓存
  const clearUserCache = () => {
    const deletedCount = cacheManager.deleteByPattern(/^\/users/);
    console.log(`Cleared ${deletedCount} cache entries`);
  };
  
  // 刷新特定模式的缓存
  const refreshDataCache = () => {
    refreshCacheByPattern(/^\/data/);
  };
  
  // 获取缓存统计
  const getCacheStats = () => {
    const stats = cacheManager.getStats();
    console.log('Cache stats:', stats);
  };
  
  return (
    <div>
      <button onClick={clearUserCache}>Clear User Cache</button>
      <button onClick={refreshDataCache}>Refresh Data Cache</button>
      <button onClick={getCacheStats}>Show Cache Stats</button>
    </div>
  );
}
```

## 缓存策略

- `default`: 默认策略，不自动刷新
- `frequent`: 频繁更新数据，30秒自动刷新
- `static`: 静态数据，不自动刷新，缓存时间更长
- `realtime`: 实时数据，5秒自动刷新

## 最佳实践

1. 根据数据特性选择合适的缓存策略
2. 对于敏感数据，设置适当的 `revalidateOnFocus` 和 `revalidateOnReconnect` 
3. 使用 `useResource` Hook 管理完整的 CRUD 操作
4. 对于大型列表，使用分页和搜索 Hook
5. 合理使用缓存管理工具，优化应用性能

## 类型安全

所有 Hook 都支持泛型，提供完整的类型安全：

```tsx
interface User {
  id: string;
  name: string;
  email: string;
}

const { data } = useApiGet<User[]>('/users');
// data 的类型会被推断为 User[] | undefined
```