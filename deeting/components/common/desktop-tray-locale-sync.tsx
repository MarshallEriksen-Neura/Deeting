"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
const TRAY_LOCALE_EVENT = "desktop-locale-changed";

export function DesktopTrayLocaleSync() {
  const locale = useLocale();

  useEffect(() => {
    if (!isTauri || typeof window === "undefined") return;

    (async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(TRAY_LOCALE_EVENT, { locale });
      } catch (err) {
        console.error("tray locale sync failed:", err);
      }
    })();
  }, [locale]);

  return null;
}
