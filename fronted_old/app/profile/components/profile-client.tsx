"use client";

import { useI18n } from "@/lib/i18n-context";
import { useAuthStore } from "@/lib/stores/auth-store";
import { ProfileHeader } from "./profile-header";
import { ProfileInfoCard } from "./profile-info-card";
import { PasswordChangeCard } from "./password-change-card";
import { SessionsCard } from "./sessions-card";
import { PreferencesCard } from "./preferences-card";
import { DangerZoneCard } from "./danger-zone-card";

export function ProfileClient() {
  const { t } = useI18n();
  const authUser = useAuthStore((state) => state.user);
  const isAuthLoading = useAuthStore((state) => state.isLoading);

  if (isAuthLoading) {
    return (
      <div>
        <p className="text-muted-foreground">
          {t("common.loading") || "Loading..."}
        </p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold mb-2">{t("nav.my_profile")}</h1>
        <p className="text-muted-foreground">{t("errors.unauthorized")}</p>
      </div>
    );
  }

  return (
    <>
      <ProfileHeader />
      <ProfileInfoCard />
      <PasswordChangeCard />
      <SessionsCard />
      <PreferencesCard />
      <DangerZoneCard />
    </>
  );
}
