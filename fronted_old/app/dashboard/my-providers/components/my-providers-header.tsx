"use client";

import { useI18n } from "@/lib/i18n-context";

export function MyProvidersHeader() {
  const { t } = useI18n();

  return (
    <div className="space-y-1">
      <h1 className="text-3xl font-bold">{t("providers.management_title")}</h1>
      <p className="text-muted-foreground text-sm">
        {t("providers.management_subtitle")}
      </p>
    </div>
  );
}

