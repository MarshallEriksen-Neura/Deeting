import type { 
  ProviderHubResponse, ProviderCard, ProviderVerifyRequest, ProviderVerifyResponse,
  ProviderInstanceCreate, ProviderInstanceResponse, ProviderInstanceUpdate, ProviderModelResponse,
  ProviderModelUpdate, ProviderModelTestRequest, ProviderModelTestResponse
} from '@/lib/api/providers';
import type {
  ApiKeyListResponse, ApiKey, CreateApiKeyRequest, CreateApiKeyResponse,
  UpdateApiKeyRequest, RollApiKeyResponse
} from '@/lib/api/api-keys';

export interface IModelService {
  /**
   * 连接模型提供商 (High Level Action)
   * Web端行为: 拦截 -> 弹窗引导下载
   * Desktop端行为: 调用 Rust 连接本地服务
   */
  connect(providerId: string): Promise<void>;

  /**
   * 获取模型列表
   * 两端都需要，但数据源不同
   */
  getList(): Promise<unknown[]>;
}

export interface IProviderService {
  getHub(params?: { category?: string; q?: string; include_public?: boolean }): Promise<ProviderHubResponse>;
  getDetail(slug: string): Promise<ProviderCard>;
  verify(payload: ProviderVerifyRequest): Promise<ProviderVerifyResponse>;
  createInstance(payload: ProviderInstanceCreate): Promise<ProviderInstanceResponse>;
  getInstances(params?: { include_public?: boolean }): Promise<ProviderInstanceResponse[]>;
  updateInstance(id: string, payload: ProviderInstanceUpdate): Promise<ProviderInstanceResponse>;
  deleteInstance(id: string): Promise<void>;
  getModels(instanceId: string): Promise<ProviderModelResponse[]>;
  syncModels(instanceId: string, options?: { preserve_user_overrides?: boolean }): Promise<ProviderModelResponse[]>;
  quickAddModels(instanceId: string, payload: { models: string[]; capability?: string }): Promise<ProviderModelResponse[]>;
  updateModel(modelId: string, payload: ProviderModelUpdate): Promise<ProviderModelResponse>;
  testModel(modelId: string, payload?: ProviderModelTestRequest): Promise<ProviderModelTestResponse>;
}

export interface IApiKeyService {
  list(params?: { page?: number; page_size?: number }): Promise<ApiKeyListResponse>;
  getById(id: string): Promise<ApiKey>;
  create(payload: CreateApiKeyRequest): Promise<CreateApiKeyResponse>;
  update(id: string, payload: UpdateApiKeyRequest): Promise<ApiKey>;
  revoke(id: string): Promise<ApiKey>;
  roll(id: string): Promise<RollApiKeyResponse>;
  delete(id: string): Promise<void>;
}

export interface IAppService {
  /**
   * 退出应用
   * Web端: 无效或跳回首页
   * Desktop端: 真正的 Quit
   */
  quit(): Promise<void>;

  /**
   * 打开外部链接
   * Web端: window.open
   * Desktop端: shell.open
   */
  openExternal(url: string): Promise<void>;
}

// 聚合接口
export interface IPlatform {
  env: 'web' | 'desktop';
  model: IModelService;
  provider: IProviderService;
  apiKey: IApiKeyService;
  app: IAppService;
}
