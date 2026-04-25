"use client";

import { Suspense, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { IconButton } from "@/components/ui/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { useLanguageStore } from "@/store/language-store";
import { usePathname, useRouter, type AppLocale } from "@/i18n/routing";
import { useInterfaceTransitionStore } from "@/store/interface-transition-store";

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function LanguageSwitcherContent() {
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const searchParams = useSearchParams();
  const mounted = useMounted();
  const pathname = usePathname();
  const router = useRouter();
  const { language, hydrated, setLanguage } = useLanguageStore();
  const isLocaleTransitioning = useInterfaceTransitionStore(
    (state) => state.isLocaleTransitioning
  );
  const startLocaleTransition = useInterfaceTransitionStore(
    (state) => state.startLocaleTransition
  );
  const endLocaleTransition = useInterfaceTransitionStore((state) => state.endLocaleTransition);

  const query = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const activeLanguage = hydrated && language ? language : locale;

  const languageOptions = useMemo(
    () => [
      { value: "zh-CN" as AppLocale, label: tCommon("language.zhCN") },
      { value: "en" as AppLocale, label: tCommon("language.en") },
    ],
    [tCommon]
  );

  const syncLocale = useCallback(
    (targetLocale: AppLocale) => {
      const hasQuery = Object.keys(query).length > 0;
      const href = (hasQuery ? { pathname, query } : pathname) as Parameters<typeof router.replace>[0];
      router.replace(href, { locale: targetLocale });
    },
    [pathname, query, router]
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!language) {
      setLanguage(locale);
      return;
    }
    if (language !== locale) {
      syncLocale(language);
    }
  }, [hydrated, language, locale, setLanguage, syncLocale]);

  useEffect(() => {
    if (!isLocaleTransitioning) {
      return;
    }
    if (!language || language !== locale) {
      return;
    }

    const timer = window.setTimeout(() => {
      endLocaleTransition();
    }, 240);

    return () => {
      window.clearTimeout(timer);
    };
  }, [endLocaleTransition, isLocaleTransitioning, language, locale, pathname]);

  const handleLanguageChange = (target: AppLocale) => {
    if (target === locale || isLocaleTransitioning) {
      return;
    }

    startLocaleTransition();
    setLanguage(target);
    window.setTimeout(() => {
      startTransition(() => {
        syncLocale(target);
      });
    }, 90);
  };

  if (!mounted) {
    return <LanguageSwitcherFallback />;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="surface"
          size="md"
          label={tCommon("language.label")}
          className="relative"
          disabled={isLocaleTransitioning}
        >
          <Languages className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        collisionPadding={8}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>{tCommon("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {languageOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="flex items-center justify-between"
            onClick={() => handleLanguageChange(option.value)}
          >
            <span>{option.label}</span>
            {activeLanguage === option.value ? (
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                on
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageSwitcherFallback() {
  const tCommon = useTranslations("common");

  return (
    <IconButton variant="surface" size="md" label={tCommon("language.label")}>
      <Languages className="size-4" />
    </IconButton>
  );
}

export function LanguageSwitcher() {
  return (
    <Suspense fallback={<LanguageSwitcherFallback />}>
      <LanguageSwitcherContent />
    </Suspense>
  );
}
