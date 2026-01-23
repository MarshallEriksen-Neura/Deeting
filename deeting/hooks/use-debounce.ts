import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * useDebounce Hook - 防抖处理
 * 
 * @param value - 需要防抖的值
 * @param delay - 延迟时间（毫秒）
 * @returns 包含防抖后的值和控制方法的对象
 * 
 * @example
 * ```tsx
 * // 基本用法
 * const debouncedValue = useDebounce(searchTerm, 500)
 * 
 * // 使用控制方法
 * const { debouncedValue, reset, cancel } = useDebounce(searchTerm, 500, { 
 *   returnObject: true 
 * })
 * ```
 */
export function useDebounce<T>(
  value: T,
  delay: number,
  options?: { returnObject?: false }
): T
export function useDebounce<T>(
  value: T,
  delay: number,
  options: { returnObject: true }
): {
  debouncedValue: T
  reset: () => void
  cancel: () => void
}
export function useDebounce<T>(
  value: T,
  delay: number,
  options?: { returnObject?: boolean }
): T | { debouncedValue: T; reset: () => void; cancel: () => void } {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 清理定时器
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // 重置为初始值
  const reset = useCallback(() => {
    cancel()
    setDebouncedValue(value)
  }, [value, cancel])

  useEffect(() => {
    // 清理之前的定时器
    cancel()

    // 设置新的定时器
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value)
      timeoutRef.current = null
    }, delay)

    // 清理函数
    return cancel
  }, [value, delay, cancel])

  // 根据选项返回不同的结果
  if (options?.returnObject) {
    return { debouncedValue, reset, cancel }
  }

  return debouncedValue
}