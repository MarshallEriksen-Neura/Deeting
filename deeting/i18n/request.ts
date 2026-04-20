import { getRequestConfig } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";

const namespaces = ["common"] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = (await requestLocale) as string | null;

  if (!locale || !routing.locales.includes(locale as AppLocale)) {
    locale = routing.defaultLocale;
  }

  const messagesEntries = await Promise.all(
    namespaces.map(async (namespace) => {
      const mod = await import(`../messages/${locale}/${namespace}.json`);
      const raw = mod.default as Record<string, unknown>;
      const scoped = (raw[namespace] ?? raw) as Record<string, unknown>;
      return { [namespace]: scoped };
    })
  );

  return {
    locale,
    messages: Object.assign({}, ...messagesEntries),
  };
});
