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
  "admin",
  "knowledge",
  "video",
  "memory",
  "plugins",
  "task-agents",
] as const

export async function loadStaticLocaleMessages(locale: string) {
  const resolvedLocale = routing.locales.includes(locale as AppLocale)
    ? locale
    : routing.defaultLocale

  const messagesEntries = await Promise.all(
    namespaces.map(async (ns) => {
      const mod = await import(`../messages/${resolvedLocale}/${ns}.json`)
      const raw = mod.default as Record<string, unknown>
      const scoped = (raw && raw[ns] ? raw[ns] : raw) as Record<string, unknown>
      return { [ns]: scoped }
    })
  )

  return Object.assign({}, ...messagesEntries) as Record<string, Record<string, unknown>>
}
