"use client";

import { useI18n } from "@/lib/i18n-context";

export function ProfileHeader() {
  const { t } = useI18n();

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">{t("nav.my_profile")}</h1>
      <p className="text-muted-foreground">{t("profile.subtitle")}</p>
    </div>
  );
}
