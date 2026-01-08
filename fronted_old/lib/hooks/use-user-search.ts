import { useCallback, useEffect, useMemo, useState } from "react";
import { userService, type UserLookup } from "@/http/user";

interface UseUserSearchOptions {
  /**
   * 自动搜索的最小关键字长度，默认 2 个字符
   */
  minLength?: number;
  /**
   * 去抖延迟，默认 300ms
   */
  debounceMs?: number;
  /**
   * 搜索返回条数上限，默认 8
   */
  limit?: number;
  /**
   * 在结果中排除的用户 ID 列表
   */
  excludeIds?: string[];
  /**
   * 关键字变化时是否自动搜索，默认 true
   */
  autoSearch?: boolean;
}

export interface UseUserSearchResult {
  query: string;
  setQuery: (value: string) => void;
  results: UserLookup[];
  loading: boolean;
  error: Error | null;
  /**
   * 手动触发搜索，可传入自定义关键字；若省略则使用当前 query
   */
  search: (keyword?: string) => Promise<void>;
  /**
   * 重置 query 与结果
   */
  reset: () => void;
  /**
   * 通过一组用户 ID 获取用户详情，常用于初始化“已选择用户”列表
   */
  fetchByIds: (ids: string[]) => Promise<UserLookup[]>;
}

/**
 * 统一的用户搜索 Hook，封装了:
 * - 去抖 + 最小字符限制
 * - 统一的 loading / error 状态
 * - 通过 ID 拉取用户详情
 */
export function useUserSearch(options: UseUserSearchOptions = {}): UseUserSearchResult {
  const {
    minLength = 2,
    debounceMs = 300,
    limit = 8,
    excludeIds = [],
    autoSearch = true,
  } = options;

  const [query, setQuery] = useState("");
  const [rawResults, setRawResults] = useState<UserLookup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const performSearch = useCallback(
    async (keyword?: string) => {
      const value = typeof keyword === "string" ? keyword : query;
      const trimmed = value.trim();
      if (!trimmed || trimmed.length < minLength) {
        setRawResults([]);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await userService.searchUsers({ q: trimmed, limit });
        setRawResults(data || []);
      } catch (err: any) {
        console.warn("Failed to search users", err);
        setError(err instanceof Error ? err : new Error("Failed to search users"));
        setRawResults([]);
      } finally {
        setLoading(false);
      }
    },
    [query, minLength, limit],
  );

  useEffect(() => {
    if (!autoSearch) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < minLength) {
      setRawResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const handle = setTimeout(() => {
      void performSearch(trimmed);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [query, minLength, debounceMs, autoSearch, performSearch]);

  const reset = useCallback(() => {
    setQuery("");
    setRawResults([]);
    setError(null);
    setLoading(false);
  }, []);

  const fetchByIds = useCallback(async (ids: string[]): Promise<UserLookup[]> => {
    if (!ids || ids.length === 0) {
      return [];
    }
    try {
      const data = await userService.searchUsers({ ids, limit: ids.length });
      return data || [];
    } catch (err) {
      console.warn("Failed to fetch users by ids", err);
      return [];
    }
  }, []);

  const filteredResults = useMemo(() => {
    if (!excludeIds || excludeIds.length === 0) {
      return rawResults;
    }
    const excludeSet = new Set(excludeIds);
    return rawResults.filter((user) => !excludeSet.has(user.id));
  }, [rawResults, excludeIds]);

  return {
    query,
    setQuery,
    results: filteredResults,
    loading,
    error,
    search: performSearch,
    reset,
    fetchByIds,
  };
}
