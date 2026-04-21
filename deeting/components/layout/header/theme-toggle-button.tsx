"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { IconButton } from "@/components/ui/common/icon-button";
import { useThemeStore } from "@/store/theme-store";

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function ThemeToggleButton() {
  const t = useTranslations("common.header");
  const { resolvedTheme, setTheme } = useTheme();
  const isTransitioning = useThemeStore((state) => state.isTransitioning);
  const startTransition = useThemeStore((state) => state.startTransition);
  const endTransition = useThemeStore((state) => state.endTransition);
  const setMode = useThemeStore((state) => state.setMode);

  const handleToggle = async () => {
    if (!resolvedTheme || isTransitioning) {
      return;
    }

    startTransition();
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    await wait(140);
    setMode(nextTheme);
    setTheme(nextTheme);
    await wait(260);
    endTransition();
  };

  const isDark = resolvedTheme === "dark";

  return (
    <IconButton
      variant="surface"
      size="md"
      label={isDark ? t("backgroundLight") : t("backgroundDark")}
      onClick={handleToggle}
      disabled={!resolvedTheme || isTransitioning}
      active={isDark}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}
