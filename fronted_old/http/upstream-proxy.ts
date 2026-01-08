import { httpClient } from './client';
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
} from '@/lib/api-types';

/**
 * 上游代理池管理服务
 */
export const upstreamProxyService = {
  // ============= 配置与状态 =============
  
  /**
   * 获取上游代理全局配置
   */
  async getConfig(): Promise<UpstreamProxyConfig> {
    return httpClient.get('/admin/upstream-proxy/config');
  },

  /**
   * 更新上游代理全局配置
   */
  async updateConfig(data: UpdateUpstreamProxyConfigRequest): Promise<UpstreamProxyConfig> {
    return httpClient.put('/admin/upstream-proxy/config', data);
  },

  /**
   * 获取代理池状态
   */
  async getStatus(): Promise<UpstreamProxyStatus> {
    return httpClient.get('/admin/upstream-proxy/status');
  },

  // ============= 来源管理 =============
  
  /**
   * 获取所有代理来源
   */
  async getSources(): Promise<UpstreamProxySource[]> {
    return httpClient.get('/admin/upstream-proxy/sources');
  },

  /**
   * 创建代理来源
   */
  async createSource(data: CreateUpstreamProxySourceRequest): Promise<UpstreamProxySource> {
    return httpClient.post('/admin/upstream-proxy/sources', data);
  },

  /**
   * 更新代理来源
   */
  async updateSource(sourceId: string, data: UpdateUpstreamProxySourceRequest): Promise<UpstreamProxySource> {
    return httpClient.put(`/admin/upstream-proxy/sources/${sourceId}`, data);
  },

  /**
   * 删除代理来源
   */
  async deleteSource(sourceId: string): Promise<void> {
    return httpClient.delete(`/admin/upstream-proxy/sources/${sourceId}`);
  },

  // ============= 条目管理 =============
  
  /**
   * 获取代理条目列表
   */
  async getEndpoints(sourceId?: string): Promise<UpstreamProxyEndpoint[]> {
    const params = sourceId ? { source_id: sourceId } : {};
    return httpClient.get('/admin/upstream-proxy/endpoints', { params });
  },

  /**
   * 创建代理条目
   */
  async createEndpoint(data: CreateUpstreamProxyEndpointRequest): Promise<UpstreamProxyEndpoint> {
    return httpClient.post('/admin/upstream-proxy/endpoints', data);
  },

  /**
   * 更新代理条目
   */
  async updateEndpoint(endpointId: string, data: UpdateUpstreamProxyEndpointRequest): Promise<UpstreamProxyEndpoint> {
    return httpClient.put(`/admin/upstream-proxy/endpoints/${endpointId}`, data);
  },

  /**
   * 删除代理条目
   */
  async deleteEndpoint(endpointId: string): Promise<void> {
    return httpClient.delete(`/admin/upstream-proxy/endpoints/${endpointId}`);
  },

  /**
   * 批量导入代理条目
   */
  async importEndpoints(data: UpstreamProxyImportRequest): Promise<UpstreamProxyImportResponse> {
    return httpClient.post('/admin/upstream-proxy/endpoints/import', data);
  },

  // ============= 任务触发 =============
  
  /**
   * 触发远程列表刷新
   */
  async triggerRefresh(): Promise<UpstreamProxyTaskResponse> {
    return httpClient.post('/admin/upstream-proxy/tasks/refresh');
  },

  /**
   * 触发代理测活与 Redis 可用池重建
   */
  async triggerHealthCheck(): Promise<UpstreamProxyTaskResponse> {
    return httpClient.post('/admin/upstream-proxy/tasks/check');
  },
};
