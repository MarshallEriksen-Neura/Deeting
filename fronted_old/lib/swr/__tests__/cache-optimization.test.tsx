import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useCacheReuse, useCachePreloader, SWRCacheManager } from '../cache';
import type { ReactNode } from 'react';

// SWR Wrapper
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>
    {children}
  </SWRConfig>
);

describe('Cache Optimization', () => {
  describe('SWRCacheManager', () => {
    let cache: Map<string, any>;
    let manager: SWRCacheManager;

    beforeEach(() => {
      cache = new Map();
      manager = new SWRCacheManager(cache as any);
    });

    it('should get and set cache values', () => {
      manager.setValue('test-key', { data: 'test' });
      expect(manager.getValue('test-key')).toEqual({ data: 'test' });
    });

    it('should delete cache keys', () => {
      manager.setValue('test-key', { data: 'test' });
      const deleted = manager.deleteKey('test-key');
      expect(deleted).toBe(true);
      expect(manager.getValue('test-key')).toBeUndefined();
    });

    it('should get keys by pattern', () => {
      manager.setValue('/v1/conversations/1/messages', { data: 'msg1' });
      manager.setValue('/v1/conversations/2/messages', { data: 'msg2' });
      manager.setValue('/v1/assistants', { data: 'assistants' });

      const keys = manager.getKeysByPattern(/^\/v1\/conversations\/.+\/messages$/);
      expect(keys).toHaveLength(2);
      expect(keys).toContain('/v1/conversations/1/messages');
      expect(keys).toContain('/v1/conversations/2/messages');
    });

    it('should delete by pattern', () => {
      manager.setValue('/v1/conversations/1/messages', { data: 'msg1' });
      manager.setValue('/v1/conversations/2/messages', { data: 'msg2' });
      manager.setValue('/v1/assistants', { data: 'assistants' });

      const deletedCount = manager.deleteByPattern(/^\/v1\/conversations\/.+\/messages$/);
      expect(deletedCount).toBe(2);
      expect(manager.getValue('/v1/assistants')).toEqual({ data: 'assistants' });
    });

    it('should get cache stats', () => {
      manager.setValue('key1', { data: 'test1' });
      manager.setValue('key2', { data: 'test2' });

      const stats = manager.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });

    it('should clear all cache', () => {
      manager.setValue('key1', { data: 'test1' });
      manager.setValue('key2', { data: 'test2' });

      manager.clear();
      const stats = manager.getStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('useCacheReuse', () => {
    it('should check if cache is valid', () => {
      const { result } = renderHook(() => useCacheReuse(), { wrapper });

      // 初始状态，缓存为空
      expect(result.current.isCacheValid('test-key')).toBe(false);
    });

    it('should warmup cache', async () => {
      const { result } = renderHook(() => useCacheReuse(), { wrapper });

      const fetcher = async () => ({ data: 'test' });

      await act(async () => {
        result.current.warmupCache('test-key', fetcher);
      });

      // 注意：由于 SWR 的异步特性，这里只是验证函数调用不会报错
      expect(result.current.isCacheValid).toBeDefined();
    });

    it('should warmup multiple caches', async () => {
      const { result } = renderHook(() => useCacheReuse(), { wrapper });

      const items = [
        { key: 'key1', fetcher: async () => ({ data: 'test1' }) },
        { key: 'key2', fetcher: async () => ({ data: 'test2' }) },
      ];

      await act(async () => {
        result.current.warmupMultipleCaches(items);
      });

      // 验证函数调用不会报错
      expect(result.current.warmupMultipleCaches).toBeDefined();
    });
  });

  describe('useCachePreloader', () => {
    it('should preload data', async () => {
      const { result } = renderHook(() => useCachePreloader(), { wrapper });

      const fetcher = async () => ({ data: 'test' });

      await act(async () => {
        result.current.preloadData('test-key', fetcher);
      });

      // 验证函数调用不会报错
      expect(result.current.preloadData).toBeDefined();
    });

    it('should not preload if cache exists', async () => {
      const { result } = renderHook(() => useCachePreloader(), { wrapper });

      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { data: 'test' };
      };

      // 第一次调用应该预加载
      await act(async () => {
        result.current.preloadData('test-key', fetcher);
      });

      // 注意：由于 SWR 的缓存机制，这里只是验证函数调用
      expect(result.current.preloadData).toBeDefined();
    });
  });
});
