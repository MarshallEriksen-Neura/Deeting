'use client';

import { useEffect, useRef } from 'react';
import { mark, measure, logComponentRender } from '@/lib/utils/performance';

/**
 * 性能监控 Hook
 * 用于在组件中测量渲染性能
 * 
 * @param componentName - 组件名称
 * @param enabled - 是否启用性能监控，默认为 true
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   usePerformance('MyComponent');
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function usePerformance(componentName: string, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const cleanup = logComponentRender(componentName);
    return cleanup;
  }, [componentName, enabled]);
}

/**
 * 测量异步操作性能的 Hook
 * 
 * @param operationName - 操作名称
 * @returns 包含 start 和 end 函数的对象
 * 
 * @example
 * ```tsx
 * function DataComponent() {
 *   const { start, end } = useMeasure('data-fetch');
 *   
 *   const fetchData = async () => {
 *     start();
 *     await fetch('/api/data');
 *     const duration = end();
 *     console.log(`Fetch took ${duration}ms`);
 *   };
 *   
 *   return <button onClick={fetchData}>Fetch</button>;
 * }
 * ```
 */
export function useMeasure(operationName: string) {
  const startMarkRef = useRef<string>(`${operationName}-start`);
  const endMarkRef = useRef<string>(`${operationName}-end`);

  const start = () => {
    mark(startMarkRef.current);
  };

  const end = (): number | null => {
    mark(endMarkRef.current);
    return measure(operationName, startMarkRef.current, endMarkRef.current);
  };

  return { start, end };
}

/**
 * 监控组件挂载时间的 Hook
 * 
 * @param componentName - 组件名称
 * @param onMount - 挂载完成时的回调函数，接收挂载时间作为参数
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   useMountTime('MyComponent', (duration) => {
 *     console.log(`Component mounted in ${duration}ms`);
 *   });
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useMountTime(
  componentName: string,
  onMount?: (duration: number) => void
) {
  const mountStartRef = useRef<number>(0);

  // 在组件首次渲染时记录开始时间
  if (mountStartRef.current === 0) {
    mountStartRef.current = performance.now();
  }

  useEffect(() => {
    const mountEnd = performance.now();
    const duration = mountEnd - mountStartRef.current;

    console.log(`[Performance] ${componentName} mounted in ${duration.toFixed(2)}ms`);

    if (onMount) {
      onMount(duration);
    }
  }, [componentName, onMount]);
}

/**
 * 监控组件更新性能的 Hook
 * 
 * @param componentName - 组件名称
 * @param dependencies - 依赖数组，当这些依赖变化时会触发性能测量
 * 
 * @example
 * ```tsx
 * function MyComponent({ data }) {
 *   useUpdatePerformance('MyComponent', [data]);
 *   
 *   return <div>{data}</div>;
 * }
 * ```
 */
export function useUpdatePerformance(
  componentName: string,
  dependencies: any[]
) {
  const isFirstRender = useRef(true);
  const updateStartRef = useRef<number>(0);

  // 在依赖变化前记录时间
  if (!isFirstRender.current) {
    updateStartRef.current = performance.now();
  }

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const updateEnd = performance.now();
    const duration = updateEnd - updateStartRef.current;

    console.log(`[Performance] ${componentName} updated in ${duration.toFixed(2)}ms`);
  }, dependencies); // eslint-disable-line react-hooks/exhaustive-deps
}
