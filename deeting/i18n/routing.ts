import {defineRouting} from "next-intl/routing"
import {createNavigation} from "next-intl/navigation"

export const routing = defineRouting({
  // 支持的语言列表
  locales: ["zh-CN", "en"],
  // 默认语言
  defaultLocale: "zh-CN",
  // 根据需要前缀，首页默认无前缀，其他路由带前缀，便于 SEO
  localePrefix: "as-needed",
  // 预留路径映射（示例，可按需扩展）
  pathnames: {
    "/": "/",
    "/overview": {
      "zh-CN": "/overview",
      en: "/overview",
    },
  },
})

export type AppLocale = (typeof routing)["locales"][number]

export const {Link, redirect, usePathname, useRouter, getPathname} =
  createNavigation(routing)
