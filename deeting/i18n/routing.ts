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
    "/dashboard": {
      "zh-CN": "/dashboard",
      en: "/dashboard",
    },
    "/chat": {
      "zh-CN": "/chat",
      en: "/chat",
    },
    "/chat/select-agent": {
      "zh-CN": "/chat/select-agent",
      en: "/chat/select-agent",
    },
    "/chat/coder": {
      "zh-CN": "/chat/coder",
      en: "/chat/coder",
    },
    "/chat/voice": {
      "zh-CN": "/chat/voice",
      en: "/chat/voice",
    },
    "/chat/create/image": {
      "zh-CN": "/chat/create/image",
      en: "/chat/create/image",
    },
  },
})

export type AppLocale = (typeof routing)["locales"][number]

export const {Link, redirect, usePathname, useRouter, getPathname} =
  createNavigation(routing)
