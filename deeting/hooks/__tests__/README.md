# Hooks 测试文档

本目录包含所有自定义 React Hooks 的单元测试。

## 测试框架

- **测试框架**: Jest 29.x
- **测试工具**: @testing-library/react
- **断言库**: @testing-library/jest-dom

## 运行测试

### 安装依赖

首先需要安装测试相关的依赖：

```bash
npm install
# 或
yarn install
# 或
pnpm install
```

### 运行所有测试

```bash
npm test
```

### 监听模式（开发时推荐）

```bash
npm run test:watch
```

### 生成覆盖率报告

```bash
npm run test:coverage
```

覆盖率报告将生成在 `coverage/` 目录下。

## 测试文件组织

测试文件与源文件对应：

```
hooks/
├── use-debounce.ts          # Hook 源文件
└── __tests__/
    ├── README.md            # 本文档
    └── use-debounce.test.ts # 测试文件
```

## 测试覆盖目标

根据项目规范，测试覆盖率目标：

- **整体覆盖率**: ≥ 80%
- **核心组件覆盖率**: ≥ 90%
- **工具函数覆盖率**: ≥ 95%
- **分支覆盖率**: ≥ 75%

## useDebounce Hook 测试说明

### 测试覆盖范围

`use-debounce.test.ts` 包含以下测试场景：

#### 1. 基础防抖功能
- ✅ 返回初始值
- ✅ 在延迟后更新值
- ✅ 连续输入时重置计时器
- ✅ 支持不同的延迟时间
- ✅ 支持不同类型的值（字符串、数字、对象、数组）

#### 2. 清理功能
- ✅ 组件卸载时清理定时器

#### 3. 高级功能（returnObject: true）
- ✅ 返回包含控制方法的对象
- ✅ reset 方法立即更新为当前值
- ✅ cancel 方法取消防抖
- ✅ reset 后再次更新正常工作
- ✅ cancel 后再次更新正常工作

#### 4. 边界情况
- ✅ 处理 0 延迟
- ✅ 处理非常大的延迟
- ✅ 处理 undefined 值
- ✅ 处理 null 值
- ✅ 处理空字符串

#### 5. 实际使用场景
- ✅ 搜索输入场景（500ms 延迟）
- ✅ 输入框场景（300ms 延迟）
- ✅ 窗口大小调整场景

### 运行特定测试

```bash
# 只运行 useDebounce 测试
npm test use-debounce

# 运行特定测试套件
npm test -- --testNamePattern="基础防抖功能"
```

## 编写新测试的最佳实践

### 1. 使用 renderHook

```typescript
import { renderHook, act } from '@testing-library/react'

const { result, rerender } = renderHook(
  ({ value, delay }) => useDebounce(value, delay),
  { initialProps: { value: 'initial', delay: 500 } }
)
```

### 2. 使用 Fake Timers

对于涉及时间的测试，使用 Jest 的 fake timers：

```typescript
beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

// 在测试中
act(() => {
  jest.advanceTimersByTime(500)
})
```

### 3. 测试清理

确保测试组件的清理逻辑：

```typescript
const { unmount } = renderHook(() => useDebounce('value', 500))
unmount()
```

### 4. 描述性测试名称

使用清晰的中文描述测试意图：

```typescript
describe('useDebounce', () => {
  it('应该在延迟后更新值', () => {
    // 测试代码
  })
})
```

## 常见问题

### Q: 测试运行很慢？

A: 确保使用了 fake timers，避免真实的延迟等待。

### Q: 测试中的定时器没有触发？

A: 确保使用 `act()` 包裹时间推进操作：

```typescript
act(() => {
  jest.advanceTimersByTime(500)
})
```

### Q: 如何测试异步更新？

A: 使用 `waitFor` 或 `act` 等待状态更新：

```typescript
import { waitFor } from '@testing-library/react'

await waitFor(() => {
  expect(result.current).toBe('updated')
})
```

## 持续集成

测试会在以下情况自动运行：

- 提交代码前（pre-commit hook）
- Pull Request 创建时
- 合并到主分支前

确保所有测试通过后再提交代码。

## 参考资料

- [Jest 文档](https://jestjs.io/docs/getting-started)
- [React Testing Library 文档](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Library Hooks](https://react-hooks-testing-library.com/)
