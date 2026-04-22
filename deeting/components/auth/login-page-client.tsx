"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LoginForm } from "@/components/auth/login-form";
import { normalizeAuthCallbackUrl } from "@/lib/auth/world-model";
import { useAuthStore } from "@/store/auth-store";

export function LoginPageClient() {
  const t = useTranslations("auth.login.page");
  const searchParams = useSearchParams();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const desktopLoginSessionId = searchParams.get("desktop_login_session")?.trim() ?? "";
  const hasDesktopBrowserSession = desktopLoginSessionId.length > 0;
  const callbackUrl = useMemo(
    () => normalizeAuthCallbackUrl(searchParams.get("callbackUrl"), "/"),
    [searchParams]
  );

  useEffect(() => {
    if (!isAuthenticated || hasDesktopBrowserSession) {
      return;
    }

    window.location.replace(callbackUrl);
  }, [callbackUrl, hasDesktopBrowserSession, isAuthenticated]);

  if (isAuthenticated && !hasDesktopBrowserSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_30%),var(--window-bg)] px-4">
        <div className="w-full max-w-sm rounded-[28px] border border-[var(--hairline)] bg-[color:var(--panel-bg)] px-6 py-8 text-center shadow-[0_28px_80px_-36px_rgba(15,23,42,0.35)]">
          <p className="text-sm font-medium text-[var(--ink-2)]">Already signed in. Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_30%),var(--window-bg)] px-4 py-10">
      <div className="w-full max-w-md rounded-[32px] border border-[var(--hairline)] bg-[color:var(--panel-bg)] px-6 py-8 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.38)] sm:px-8">
        <div className="mb-8 space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-lg font-semibold text-[var(--accent-ink)]">
            D
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{t("title")}</h1>
          <p className="text-sm text-[var(--ink-3)]">{t("subtitle")}</p>
        </div>

        <LoginForm
          onSuccess={async () => {
            if (!hasDesktopBrowserSession) {
              window.location.replace(callbackUrl);
            }
          }}
        />
      </div>
    </div>
  );
}
