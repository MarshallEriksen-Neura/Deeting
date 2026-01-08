# SWR 缓存优化指南

本文档说明聊天助手系统中 SWR 缓存策略的配置和优化方法。

## 缓存策略配置

### 1. 缓存策略类型

我们定义了四种缓存策略（位于 `cache.ts`）：

#### default（默认策略）
```typescript
{
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 2000,
}
```
- **适用场景**：单个资源详情（助手详情、会话详情、Run 详情）
- **特点**：不在焦点时重新验证，减少不必要的请求

#### frequent（频繁更新策略）
```typescript
{
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 30000, // 30秒
  dedupingInterval: 1000,
}
```
- **适用场景**：会话列表、消息列表
- **特点**：焦点时重新验证，30秒自动刷新，适合实时对话场景

#### static（静态数据策略）
```typescript
{
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshInterval: 0,
  dedupingInterval: 60000,
}
```
- **适用场景**：助手列表、评测配置
- **特点**：不自动刷新，适合变化不频繁的数据

#### realtime（实时数据策略）
```typescript
{
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 5000, // 5秒
  dedupingInterval: 500,
}
```
- **适用场景**：需要高频更新的数据
- **特点**：5秒自动刷新，适合实时监控场景

### 2. 各模块缓存策略

| 模块 | Hook | 缓存策略 | 原因 |
|------|------|---------|------|
| 助手管理 | `useAssistants` | `static` | 助手列表变化不频繁 |
| 助手管理 | `useAssistant` | `default` | 单个助手详情按需加载 |
| 会话管理 | `useConversations` | `frequent` | 新消息会更新 last_activity_at |
| 会话管理 | `useConversation` | `default` | 单个会话详情按需加载 |
| 消息历史 | `useMessages` | `frequent` | 实时对话场景 |
| 消息历史 | `useRun` | `default` | Run 详情惰性加载 |
| 评测 | `useEval` | 自定义轮询 | 使用递增退避策略 |
| 评测配置 | `useEvalConfig` | `static` | 管理员配置，变化不频繁 |

## 缓存优化技巧

### 1. 使用 useMemo 优化缓存键

所有 SWR hooks 都使用 `useMemo` 来生成缓存键，避免不必要的重新渲染：

```typescript
const key = useMemo(
  () => conversationId ? {
    url: `/v1/conversations/${conversationId}/messages`,
    params,
  } : null,
  [conversationId, params?.cursor, params?.limit]
);
```

**注意**：只依赖实际使用的参数字段，而不是整个 params 对象。

### 2. 缓存复用

使用 `useCacheReuse` hook 来检查和预热缓存：

```typescript
const { isCacheValid, warmupCache } = useCacheReuse();

// 检查缓存是否有效
if (isCacheValid(key)) {
  // 使用缓存数据
}

// 预热缓存（在用户可能访问之前）
warmupCache(key, fetcher);
```

### 3. 乐观更新

在发送消息时使用乐观更新，立即显示用户消息：

```typescript
// 乐观更新
await globalMutate(
  messagesKey,
  async (currentData) => ({
    ...currentData,
    items: [...currentData.items, optimisticMessage],
  }),
  { revalidate: false }
);

// 发送请求
const response = await messageService.sendMessage(conversationId, request);

// 更新为真实数据
await globalMutate(messagesKey);
```

### 4. 批量缓存管理

使用 `SWRCacheManager` 进行批量缓存操作：

```typescript
const { cacheManager } = useSWRCache();

// 根据模式删除缓存
cacheManager.deleteByPattern(/^\/v1\/conversations\/.+\/messages$/);

// 获取缓存统计
const stats = cacheManager.getStats();
console.log(`缓存数量: ${stats.size}`);
```

## 性能优化建议

### 1. 避免过度请求

- 使用 `dedupingInterval` 防止短时间内重复请求
- 对于静态数据，使用 `static` 策略避免不必要的刷新
- 使用 `revalidateOnFocus: false` 减少焦点切换时的请求

### 2. 预加载数据

在用户可能访问的页面之前预加载数据：

```typescript
const { preloadData } = useCachePreloader();

// 预加载下一页数据
if (nextCursor) {
  preloadData(
    `/v1/conversations/${conversationId}/messages?cursor=${nextCursor}`,
    () => messageService.getMessages(conversationId, { cursor: nextCursor })
  );
}
```

### 3. 缓存失效策略

在数据变更后，及时更新相关缓存：

```typescript
// 创建会话后，刷新会话列表缓存
await createConversation(request);
await mutate(`/v1/conversations?assistant_id=${assistantId}`);
```

### 4. 监控缓存性能

使用 `getStats()` 监控缓存使用情况：

```typescript
const { cacheManager } = useSWRCache();
const stats = cacheManager.getStats();

// 如果缓存过多，考虑清理旧缓存
if (stats.size > 100) {
  cacheManager.deleteByPattern(/^\/v1\/conversations\/.+\/messages$/);
}
```

## 常见问题

### Q: 为什么切换会话时会重新请求数据？

A: 确保使用 `useMemo` 生成缓存键，并且只依赖实际变化的参数。如果每次渲染都创建新的对象作为 key，SWR 会认为是不同的请求。

### Q: 如何减少评测轮询的请求频率？

A: 使用递增退避策略（1s → 2s → 3s），并在评测完成时停止轮询。参考 `useEval` 的实现。

### Q: 如何处理大量历史消息的缓存？

A: 使用分页加载，每页只缓存 50 条消息。使用虚拟列表渲染，减少 DOM 节点数量。

## 相关文件

- `frontend/lib/swr/cache.ts` - 缓存策略配置和工具
- `frontend/lib/swr/use-messages.ts` - 消息相关 hooks
- `frontend/lib/swr/use-conversations.ts` - 会话相关 hooks
- `frontend/lib/swr/use-assistants.ts` - 助手相关 hooks
- `frontend/lib/swr/use-evals.ts` - 评测相关 hooks
