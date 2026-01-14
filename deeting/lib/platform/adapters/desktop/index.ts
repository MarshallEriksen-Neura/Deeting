import { invoke } from '@tauri-apps/api/core';
import { IPlatform } from '../../core/types';
import * as providerApi from '@/lib/api/providers';
import * as apiKeyApi from '@/lib/api/api-keys';

export const desktopPlatform: IPlatform = {
  env: 'desktop',

  model: {
    connect: async (id) => {
      // 真正的 Rust 调用
      // await invoke('connect_provider', { id });
      console.log('Desktop: Connecting provider', id);
    },
    getList: async () => {
      // Desktop 端可能直接读本地配置，或也是 fetch
      // 这里演示 invoke
      // return await invoke('get_providers');
      return [];
    }
  },

  // 目前 Desktop 端复用 Web 端的 API 逻辑（连接 Python 后端）
  // 未来可以替换为 Rust 调用
  provider: {
    getHub: providerApi.fetchProviderHub,
    getDetail: providerApi.fetchProviderDetail,
    verify: providerApi.verifyProvider,
    createInstance: providerApi.createProviderInstance,
    getInstances: providerApi.fetchProviderInstances,
    updateInstance: providerApi.updateProviderInstance,
    deleteInstance: providerApi.deleteProviderInstance,
    getModels: providerApi.fetchProviderModels,
    syncModels: providerApi.syncProviderModels,
    quickAddModels: providerApi.quickAddProviderModels,
    updateModel: providerApi.updateProviderModel,
    testModel: providerApi.testProviderModel,
  },

  apiKey: {
    list: apiKeyApi.fetchApiKeys,
    getById: apiKeyApi.fetchApiKeyById,
    create: apiKeyApi.createApiKey,
    update: apiKeyApi.updateApiKey,
    revoke: apiKeyApi.revokeApiKey,
    roll: apiKeyApi.rollApiKey,
    delete: apiKeyApi.deleteApiKey,
  },

  app: {
    quit: async () => {
      // await invoke('quit_app');
      console.log('Desktop: Quit app');
    },
    openExternal: async (url) => {
      // 使用 Tauri 的 shell 打开浏览器
      // import { open } from '@tauri-apps/plugin-shell';
      // await open(url);
      console.log('Desktop: Open external', url);
    }
  }
};
