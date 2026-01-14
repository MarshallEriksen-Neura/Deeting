import { IPlatform } from '../../core/types';
import * as providerApi from '@/lib/api/providers';
import * as apiKeyApi from '@/lib/api/api-keys';
import { useDownloadModalStore } from '@/store/modal-store';

export const webPlatform: IPlatform = {
  env: 'web',
  
  model: {
    connect: async (id) => {
      console.log('Web: 拦截连接请求', id);
      
      // 触发弹窗
      useDownloadModalStore.getState().openDownloadModal({
        title: "Connect Local Models",
        description: "Connecting to local LLMs (like Ollama) requires direct system access. Download the desktop app to unlock this feature."
      });
      
      // 抛错中断后续逻辑
      throw new Error('PLATFORM_RESTRICTED'); 
    },
    getList: async () => {
      // Web 端走 Next.js API Route
      return [];
    }
  },

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
      console.warn('Web cannot quit');
    },
    openExternal: async (url) => {
      window.open(url, '_blank');
    }
  }
};