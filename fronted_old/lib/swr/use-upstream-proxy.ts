"use client";

import { useCallback } from 'react';
import { useApiGet, useApiPost, useApiPut } from './hooks';
import { upstreamProxyService } from '@/http/upstream-proxy';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useI18n } from '@/lib/i18n-context';
import type {
  UpstreamProxyConfig,
  UpdateUpstreamProxyConfigRequest,
  UpstreamProxyStatus,
  UpstreamProxySource,
  CreateUpstreamProxySourceRequest,
  UpdateUpstreamProxySourceRequest,
  UpstreamProxyEndpoint,
  CreateUpstreamProxyEndpointRequest,
  UpdateUpstreamProxyEndpointRequest,
  UpstreamProxyImportRequest,
  UpstreamProxyImportResponse,
  UpstreamProxyTaskResponse,
  UpstreamProxySourcesResponse,
  UpstreamProxyEndpointsResponse,
} from '@/lib/api-types';

/**
 * 获取上游代理全局配置
 */
export const useUpstreamProxyConfig = () => {
  const user = useAuthStore(state => state.user);
  const isSuperUser = user?.is_superuser === true;
  const { t } = useI18n();

  const {
    data,
    error,
    loading,
    refresh
  } = useApiGet<UpstreamProxyConfig>(
    isSuperUser ? '/admin/upstream-proxy/config' : null,
    { strategy: 'static' }
  );

  const { trigger: updateTrigger, submitting } = useApiPut<
    UpstreamProxyConfig,
    UpdateUpstreamProxyConfigRequest
  >('/admin/upstream-proxy/config', { revalidate: false });

  const update = useCallback(
    async (payload: UpdateUpstreamProxyConfigRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await updateTrigger(payload);
      await refresh();
      return result;
    },
    [isSuperUser, updateTrigger, refresh, t]
  );

  return {
    config: data,
    loading,
    error,
    refresh,
    update,
    submitting,
    isSuperUser,
  };
};

/**
 * 获取代理池状态
 */
export const useUpstreamProxyStatus = () => {
  const user = useAuthStore(state => state.user);
  const isSuperUser = user?.is_superuser === true;

  const {
    data,
    error,
    loading,
    refresh
  } = useApiGet<UpstreamProxyStatus>(
    isSuperUser ? '/admin/upstream-proxy/status' : null,
    { strategy: 'frequent' }
  );

  return {
    status: data,
    loading,
    error,
    refresh,
    isSuperUser,
  };
};

/**
 * 获取代理来源列表
 */
export const useUpstreamProxySources = () => {
  const user = useAuthStore(state => state.user);
  const isSuperUser = user?.is_superuser === true;
  const { t } = useI18n();

  const {
    data,
    error,
    loading,
    refresh
  } = useApiGet<UpstreamProxySourcesResponse>(
    isSuperUser ? '/admin/upstream-proxy/sources' : null,
    { strategy: 'static' }
  );

  const { trigger: createTrigger, submitting: creating } = useApiPost<
    UpstreamProxySource,
    CreateUpstreamProxySourceRequest
  >('/admin/upstream-proxy/sources', { revalidate: false });

  // Note: update and delete operations use upstreamProxyService directly
  // to handle dynamic URLs with sourceId
  const updating = false;
  const deleting = false;

  const create = useCallback(
    async (payload: CreateUpstreamProxySourceRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await createTrigger(payload);
      await refresh();
      return result;
    },
    [isSuperUser, createTrigger, refresh, t]
  );

  const update = useCallback(
    async (sourceId: string, payload: UpdateUpstreamProxySourceRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await upstreamProxyService.updateSource(sourceId, payload);
      await refresh();
      return result;
    },
    [isSuperUser, refresh, t]
  );

  const remove = useCallback(
    async (sourceId: string) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      await upstreamProxyService.deleteSource(sourceId);
      await refresh();
    },
    [isSuperUser, refresh, t]
  );

  return {
    sources: data?.sources || [],
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    creating,
    updating,
    deleting,
    isSuperUser,
  };
};

/**
 * 获取代理条目列表
 */
export const useUpstreamProxyEndpoints = (sourceId?: string) => {
  const user = useAuthStore(state => state.user);
  const isSuperUser = user?.is_superuser === true;
  const { t } = useI18n();

  const url = isSuperUser
    ? `/admin/upstream-proxy/endpoints${sourceId ? `?source_id=${sourceId}` : ''}`
    : null;

  const {
    data,
    error,
    loading,
    refresh
  } = useApiGet<UpstreamProxyEndpointsResponse>(url, { strategy: 'frequent' });

  const { trigger: createTrigger, submitting: creating } = useApiPost<
    UpstreamProxyEndpoint,
    CreateUpstreamProxyEndpointRequest
  >('/admin/upstream-proxy/endpoints', { revalidate: false });

  const { trigger: importTrigger, submitting: importing } = useApiPost<
    UpstreamProxyImportResponse,
    UpstreamProxyImportRequest
  >('/admin/upstream-proxy/endpoints/import', { revalidate: false });

  const create = useCallback(
    async (payload: CreateUpstreamProxyEndpointRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await createTrigger(payload);
      await refresh();
      return result;
    },
    [isSuperUser, createTrigger, refresh, t]
  );

  const importEndpoints = useCallback(
    async (payload: UpstreamProxyImportRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await importTrigger(payload);
      await refresh();
      return result;
    },
    [isSuperUser, importTrigger, refresh, t]
  );

  const update = useCallback(
    async (endpointId: string, payload: UpdateUpstreamProxyEndpointRequest) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      const result = await upstreamProxyService.updateEndpoint(endpointId, payload);
      await refresh();
      return result;
    },
    [isSuperUser, refresh, t]
  );

  const remove = useCallback(
    async (endpointId: string) => {
      if (!isSuperUser) {
        throw new Error(t('common.error_superuser_required'));
      }
      await upstreamProxyService.deleteEndpoint(endpointId);
      await refresh();
    },
    [isSuperUser, refresh, t]
  );

  return {
    endpoints: data?.endpoints || [],
    loading,
    error,
    refresh,
    create,
    importEndpoints,
    update,
    remove,
    creating,
    importing,
    isSuperUser,
  };
};

/**
 * 代理池任务触发
 */
export const useUpstreamProxyTasks = () => {
  const user = useAuthStore(state => state.user);
  const isSuperUser = user?.is_superuser === true;
  const { t } = useI18n();

  const { trigger: refreshTrigger, submitting: refreshing } = useApiPost<
    UpstreamProxyTaskResponse,
    void
  >('/admin/upstream-proxy/tasks/refresh', { revalidate: false });

  const { trigger: checkTrigger, submitting: checking } = useApiPost<
    UpstreamProxyTaskResponse,
    void
  >('/admin/upstream-proxy/tasks/check', { revalidate: false });

  const triggerRefresh = useCallback(async () => {
    if (!isSuperUser) {
      throw new Error(t('common.error_superuser_required'));
    }
    return await refreshTrigger();
  }, [isSuperUser, refreshTrigger, t]);

  const triggerHealthCheck = useCallback(async () => {
    if (!isSuperUser) {
      throw new Error(t('common.error_superuser_required'));
    }
    return await checkTrigger();
  }, [isSuperUser, checkTrigger, t]);

  return {
    triggerRefresh,
    triggerHealthCheck,
    refreshing,
    checking,
    isSuperUser,
  };
};
