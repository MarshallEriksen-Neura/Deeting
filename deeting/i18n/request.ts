import { getRequestConfig } from "next-intl/server"
import { routing, type AppLocale } from "./routing"

const namespaces = [
  "common",
  "home",
  "auth",
  "api-keys",
  "providers",
  "models",
  "logs",
  "dashboard",
  "credits",
  "monitoring",
  "notifications",
  "profile",
  "settings",
  "assistants",
  "mcp",
  "spec-agent",
  "chat",
] as const

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = (await requestLocale) as string | null

  if (!locale || !routing.locales.includes(locale as AppLocale)) {
    locale = routing.defaultLocale
  }

  const messagesEntries = await Promise.all(
    namespaces.map(async (ns) => {
      const mod = await import(`../messages/${locale}/${ns}.json`)
      const raw = mod.default as Record<string, unknown>
      const scoped = (raw && raw[ns] ? raw[ns] : raw) as Record<string, unknown>
      return { [ns]: scoped }
    })
  )

  // 以 namespace 为一级 key，避免不同文件顶层 key 相互覆盖
  const messages = Object.assign({}, ...messagesEntries)

  return {
    locale,
    messages,
  }
})
