"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AppLocale } from "@/i18n/routing";

/** 语言状态 */
export interface LanguageState {
  /** 当前选择的语言 */
  language: AppLocale | null;
  /** 本地存储是否已完成水合 */
  hydrated: boolean;
}

/** 语言状态 Actions */
interface LanguageActions {
  /** 设置语言 */
  setLanguage: (language: AppLocale) => void;
  /** 标记已完成水合 */
  setHydrated: () => void;
}

type LanguageStore = LanguageState & LanguageActions;

/** 默认语言状态 */
const DEFAULT_LANGUAGE_STATE: LanguageState = {
  language: null,
  hydrated: false,
};

/**
 * 语言 Zustand Store
 * - 持久化到 localStorage，确保刷新/重新打开后保持选择
 * - hydrated 标记避免 SSR/CSR 不一致
 */
export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      ...DEFAULT_LANGUAGE_STATE,

      setLanguage: (language) => set({ language }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "deeting-language-store",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
