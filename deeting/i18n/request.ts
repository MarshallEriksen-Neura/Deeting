import { getRequestConfig } from "next-intl/server"
import { routing } from "./routing"

const namespaces = ["common", "home", "auth", "api-keys", "providers"] as const

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale
  }

  const messagesEntries = await Promise.all(
    namespaces.map(async (ns) => {
      const mod = await import(`../messages/${locale}/${ns}.json`)
      return mod.default
    })
  )

  // 深合并简单场景：同级 keys 不冲突情况下直接展开
  const messages = Object.assign({}, ...messagesEntries)

  return {
    locale,
    messages,
  }
})
