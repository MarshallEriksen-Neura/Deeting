import { IPlatform } from "../../core/types";
import * as apiKeyApi from "@/lib/api/api-keys";

import { desktopAppService } from "./app-service";
import { desktopModelService } from "./model-service";
import { desktopProviderService } from "./provider-service";

export const desktopPlatform: IPlatform = {
  env: "desktop",
  model: desktopModelService,
  provider: desktopProviderService,
  apiKey: {
    list: apiKeyApi.fetchApiKeys,
    getById: apiKeyApi.fetchApiKeyById,
    create: apiKeyApi.createApiKey,
    update: apiKeyApi.updateApiKey,
    revoke: apiKeyApi.revokeApiKey,
    roll: apiKeyApi.rollApiKey,
    delete: apiKeyApi.deleteApiKey,
  },
  app: desktopAppService,
};
