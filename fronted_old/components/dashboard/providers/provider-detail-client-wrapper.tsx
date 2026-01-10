"use client";

import { ProviderDetailMain } from "./provider-detail-main";
import { providerDetailTranslations } from "@/lib/i18n/provider-detail";
import { useI18n } from "@/lib/i18n-context";

interface ProviderDetailClientWrapperProps {
  providerId: string;
  currentUserId?: string | null;
}

export function ProviderDetailClientWrapper({ 
  providerId, 
  currentUserId 
}: ProviderDetailClientWrapperProps) {
  const { language } = useI18n();
  
  // 获取对应语言的翻译，默认为中文
  const localeKey: keyof typeof providerDetailTranslations =
    language === "en" ? "en-US" : "zh-CN";
  const translations = providerDetailTranslations[localeKey];

  return (
    <ProviderDetailMain
      providerId={providerId}
      currentUserId={currentUserId}
      translations={translations}
    />
  );
}
