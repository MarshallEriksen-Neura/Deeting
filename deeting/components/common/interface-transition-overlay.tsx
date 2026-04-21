"use client";

import { Loader2, Languages, Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/store/theme-store";
import { useInterfaceTransitionStore } from "@/store/interface-transition-store";

export function InterfaceTransitionOverlay() {
  const tCommon = useTranslations("common");
  const isThemeTransitioning = useThemeStore((state) => state.isTransitioning);
  const isLocaleTransitioning = useInterfaceTransitionStore(
    (state) => state.isLocaleTransitioning
  );

  const isActive = isThemeTransitioning || isLocaleTransitioning;
  const label = isThemeTransitioning
    ? tCommon("loading.theme")
    : isLocaleTransitioning
      ? tCommon("loading.language")
      : "";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 z-[1000] transition-opacity duration-300 ease-out",
        isActive ? "opacity-100" : "opacity-0"
      )}
    >
      <div className="absolute inset-0 bg-[color:var(--window-bg)]/68 backdrop-blur-xl" />

      <div
        className={cn(
          "absolute inset-x-0 top-[calc(var(--desktop-title-bar-height,0px)+24px)] flex justify-center px-4 transition-all duration-300 ease-out",
          isActive ? "translate-y-0 scale-100" : "-translate-y-2 scale-[0.985]"
        )}
      >
        <div className="flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)]/92 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(0,0,0,0.35)]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)]">
            {isThemeTransitioning ? (
              <Palette className="size-4 text-[var(--accent-ink)]" />
            ) : (
              <Languages className="size-4 text-[var(--accent-ink)]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--ink)]">{label}</div>
            <div className="mt-1 text-xs text-[var(--ink-3)]">
              {isThemeTransitioning
                ? tCommon("loading.themeDetail")
                : tCommon("loading.languageDetail")}
            </div>
          </div>

          <Loader2 className="size-4 animate-spin text-[var(--ink-3)]" />
        </div>
      </div>
    </div>
  );
}
