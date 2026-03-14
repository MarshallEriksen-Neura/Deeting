import { defineI18n } from "fumadocs-core/i18n";
import { defineI18nUI } from "fumadocs-ui/i18n";

export const docsI18n = defineI18n({
  languages: ["zh-CN", "en"],
  defaultLanguage: "zh-CN",
  hideLocale: "default-locale",
  parser: "dir",
});

export const docsI18nUI = defineI18nUI(docsI18n, {
  translations: {
    "zh-CN": {
      displayName: "简体中文",
      search: "搜索文档",
    },
    en: {
      displayName: "English",
      search: "Search docs",
    },
  },
});
