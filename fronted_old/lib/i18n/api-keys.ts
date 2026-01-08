import type { Language } from "../i18n-context";

export const apiKeysTranslations: Record<Language, Record<string, string>> = {
  en: {
    // Tooltips for API Keys table actions
    "api_keys.tooltip_copy_prefix": "Copy key prefix",
    "api_keys.tooltip_edit": "Edit API key",
    "api_keys.tooltip_delete": "Delete API key",
  },
  zh: {
    // API Keys 表格操作提示
    "api_keys.tooltip_copy_prefix": "复制密钥前缀",
    "api_keys.tooltip_edit": "编辑 API 密钥",
    "api_keys.tooltip_delete": "删除 API 密钥",
  },
};

