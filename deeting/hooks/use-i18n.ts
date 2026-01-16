import { useTranslations } from "next-intl"

export function useI18n(namespace?: string) {
  return useTranslations(namespace)
}
