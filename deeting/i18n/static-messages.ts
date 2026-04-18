import { routing, type AppLocale } from "./routing"

const namespaces = [
  "common",
  "home",
  "auth",
  "api-keys",
  "providers",
  "models",
  "model-pools",
  "logs",
  "dashboard",
  "credits",
  "monitoring",
  "notifications",
  "profile",
  "settings",
  "approval-rules",
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
  "bandit",
  "task-learning",
  "llm-wiki",
] as const

type StaticMessageNamespace = (typeof namespaces)[number]

const desktopNamespaces = namespaces.filter(
  (ns) => ns !== "admin" && ns !== "spec-agent" && ns !== "video"
) as readonly StaticMessageNamespace[]

export async function loadStaticLocaleMessages(
  locale: string,
  options?: {
    desktopExport?: boolean
    namespaces?: readonly StaticMessageNamespace[]
  }
) {
  const resolvedLocale = routing.locales.includes(locale as AppLocale)
    ? locale
    : routing.defaultLocale
  const activeNamespaces = options?.namespaces
    ? options.namespaces
    : options?.desktopExport
      ? desktopNamespaces
      : namespaces

  const messagesEntries = await Promise.all(
    activeNamespaces.map(async (ns) => {
      const mod = await import(`../messages/${resolvedLocale}/${ns}.json`)
      const raw = mod.default as Record<string, unknown>
      const scoped = (raw && raw[ns] ? raw[ns] : raw) as Record<string, unknown>
      return { [ns]: scoped }
    })
  )

  return Object.assign({}, ...messagesEntries) as Record<string, Record<string, unknown>>
}

export type { StaticMessageNamespace }
