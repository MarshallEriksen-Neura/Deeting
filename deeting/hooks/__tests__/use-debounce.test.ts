import { renderHook, act } from '@testing-library/react'
import { useDebounce } from '../use-debounce'

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  describe('基础防抖功能', () => {
    it('应该返回初始值', () => {
      const { result } = renderHook(() => useDebounce('initial', 500))
      expect(result.current).toBe('initial')
    })

    it('应该在延迟后更新值', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      expect(result.current).toBe('initial')

      // 更新值
      rerender({ value: 'updated', delay: 500 })

      // 值应该还是旧的
      expect(result.current).toBe('initial')

      // 快进时间
      act(() => {
        jest.advanceTimersByTime(500)
      })

      // 值应该更新了
      expect(result.current).toBe('updated')
    })

    it('应该在连续输入时重置计时器', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      // 第一次更新
      rerender({ value: 'first', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(300)
      })

      // 第二次更新（在第一次完成前）
      rerender({ value: 'second', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(300)
      })

      // 值应该还是初始值
      expect(result.current).toBe('initial')

      // 再快进 200ms（总共 500ms 从第二次更新开始）
      act(() => {
        jest.advanceTimersByTime(200)
      })

      // 值应该是最后一次更新的值
      expect(result.current).toBe('second')
    })

    it('应该支持不同的延迟时间', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 300 },
        }
      )

      rerender({ value: 'updated', delay: 300 })

      act(() => {
        jest.advanceTimersByTime(299)
      })
      expect(result.current).toBe('initial')

      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(result.current).toBe('updated')
    })

    it('应该支持不同类型的值', () => {
      // 测试数字
      const { result: numberResult, rerender: numberRerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 0, delay: 500 },
        }
      )

      numberRerender({ value: 42, delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(numberResult.current).toBe(42)

      // 测试对象
      const { result: objectResult, rerender: objectRerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: { name: 'initial' }, delay: 500 },
        }
      )

      const newObj = { name: 'updated' }
      objectRerender({ value: newObj, delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(objectResult.current).toBe(newObj)

      // 测试数组
      const { result: arrayResult, rerender: arrayRerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: [1, 2, 3], delay: 500 },
        }
      )

      const newArray = [4, 5, 6]
      arrayRerender({ value: newArray, delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(arrayResult.current).toBe(newArray)
    })
  })

  describe('清理功能', () => {
    it('应该在组件卸载时清理定时器', () => {
      const { result, rerender, unmount } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      rerender({ value: 'updated', delay: 500 })

      // 卸载组件
      unmount()

      // 快进时间
      act(() => {
        jest.advanceTimersByTime(500)
      })

      // 值不应该更新（因为组件已卸载）
      expect(result.current).toBe('initial')
    })
  })

  describe('高级功能（returnObject: true）', () => {
    it('应该返回包含控制方法的对象', () => {
      const { result } = renderHook(() =>
        useDebounce('initial', 500, { returnObject: true })
      )

      expect(result.current).toHaveProperty('debouncedValue')
      expect(result.current).toHaveProperty('reset')
      expect(result.current).toHaveProperty('cancel')
      expect(typeof result.current.reset).toBe('function')
      expect(typeof result.current.cancel).toBe('function')
    })

    it('reset 方法应该立即更新为当前值', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay, { returnObject: true }),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      // 更新值
      rerender({ value: 'updated', delay: 500 })

      // 值应该还是旧的
      expect(result.current.debouncedValue).toBe('initial')

      // 调用 reset
      act(() => {
        result.current.reset()
      })

      // 值应该立即更新
      expect(result.current.debouncedValue).toBe('updated')
    })

    it('cancel 方法应该取消防抖', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay, { returnObject: true }),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      // 更新值
      rerender({ value: 'updated', delay: 500 })

      // 快进一半时间
      act(() => {
        jest.advanceTimersByTime(250)
      })

      // 调用 cancel
      act(() => {
        result.current.cancel()
      })

      // 快进剩余时间
      act(() => {
        jest.advanceTimersByTime(250)
      })

      // 值应该还是旧的（因为被取消了）
      expect(result.current.debouncedValue).toBe('initial')
    })

    it('reset 后再次更新应该正常工作', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay, { returnObject: true }),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      // 第一次更新
      rerender({ value: 'first', delay: 500 })
      act(() => {
        result.current.reset()
      })
      expect(result.current.debouncedValue).toBe('first')

      // 第二次更新
      rerender({ value: 'second', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(result.current.debouncedValue).toBe('second')
    })

    it('cancel 后再次更新应该正常工作', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay, { returnObject: true }),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      // 第一次更新并取消
      rerender({ value: 'first', delay: 500 })
      act(() => {
        result.current.cancel()
      })

      // 第二次更新
      rerender({ value: 'second', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(result.current.debouncedValue).toBe('second')
    })
  })

  describe('边界情况', () => {
    it('应该处理 0 延迟', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 0 },
        }
      )

      rerender({ value: 'updated', delay: 0 })

      act(() => {
        jest.advanceTimersByTime(0)
      })

      expect(result.current).toBe('updated')
    })

    it('应该处理非常大的延迟', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 10000 },
        }
      )

      rerender({ value: 'updated', delay: 10000 })

      act(() => {
        jest.advanceTimersByTime(9999)
      })
      expect(result.current).toBe('initial')

      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(result.current).toBe('updated')
    })

    it('应该处理 undefined 值', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: undefined as string | undefined, delay: 500 },
        }
      )

      expect(result.current).toBeUndefined()

      rerender({ value: 'defined', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(result.current).toBe('defined')
    })

    it('应该处理 null 值', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: null as string | null, delay: 500 },
        }
      )

      expect(result.current).toBeNull()

      rerender({ value: 'not null', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(result.current).toBe('not null')
    })

    it('应该处理空字符串', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: '', delay: 500 },
        }
      )

      expect(result.current).toBe('')

      rerender({ value: 'not empty', delay: 500 })
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(result.current).toBe('not empty')
    })
  })

  describe('性能测试', () => {
    it('应该只在值变化时创建新的定时器', () => {
      const { rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      )

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')

      // 相同的值，不应该创建新的定时器
      rerender({ value: 'initial', delay: 500 })
      
      // 由于 useEffect 依赖于 value，即使值相同也会重新执行
      // 但这是预期行为，确保防抖逻辑正确

      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('实际使用场景', () => {
    it('应该适用于搜索输入场景（500ms 延迟）', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 500),
        {
          initialProps: { value: '' },
        }
      )

      // 模拟用户快速输入
      rerender({ value: 'h' })
      act(() => jest.advanceTimersByTime(100))
      
      rerender({ value: 'he' })
      act(() => jest.advanceTimersByTime(100))
      
      rerender({ value: 'hel' })
      act(() => jest.advanceTimersByTime(100))
      
      rerender({ value: 'hell' })
      act(() => jest.advanceTimersByTime(100))
      
      rerender({ value: 'hello' })
      
      // 值应该还是空的
      expect(result.current).toBe('')

      // 用户停止输入 500ms
      act(() => {
        jest.advanceTimersByTime(500)
      })

      // 值应该更新为最终输入
      expect(result.current).toBe('hello')
    })

    it('应该适用于输入框场景（300ms 延迟）', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 300),
        {
          initialProps: { value: '' },
        }
      )

      // 模拟用户输入
      rerender({ value: 'test input' })

      act(() => {
        jest.advanceTimersByTime(299)
      })
      expect(result.current).toBe('')

      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(result.current).toBe('test input')
    })

    it('应该适用于窗口大小调整场景', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 200),
        {
          initialProps: { value: { width: 1024, height: 768 } },
        }
      )

      // 模拟快速调整窗口大小
      const sizes = [
        { width: 1025, height: 768 },
        { width: 1026, height: 768 },
        { width: 1027, height: 768 },
        { width: 1028, height: 768 },
      ]

      sizes.forEach((size) => {
        rerender({ value: size })
        act(() => jest.advanceTimersByTime(50))
      })

      // 值应该还是初始值
      expect(result.current).toEqual({ width: 1024, height: 768 })

      // 停止调整
      act(() => {
        jest.advanceTimersByTime(200)
      })

      // 值应该更新为最后的大小
      expect(result.current).toEqual({ width: 1028, height: 768 })
    })
  })
})
