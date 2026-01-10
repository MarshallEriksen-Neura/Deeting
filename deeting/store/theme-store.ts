"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * 主题类型定义
 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * 主题状态接口
 */
export interface ThemeState {
  /** 当前主题模式 */
  mode: ThemeMode;
  /** 是否正在切换主题（用于过渡动画） */
  isTransitioning: boolean;
}

/**
 * 主题 Store Actions
 */
interface ThemeActions {
  /** 设置主题模式 */
  setMode: (mode: ThemeMode) => void;
  /** 开始主题过渡 */
  startTransition: () => void;
  /** 结束主题过渡 */
  endTransition: () => void;
}

type ThemeStore = ThemeState & ThemeActions;

/**
 * 默认主题状态
 */
const DEFAULT_THEME_STATE: ThemeState = {
  mode: "system",
  isTransitioning: false,
};

/**
 * 主题 Zustand Store
 * 使用 persist 中间件自动持久化到 localStorage
 */
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      ...DEFAULT_THEME_STATE,

      setMode: (mode) => set({ mode }),

      startTransition: () => set({ isTransitioning: true }),

      endTransition: () => set({ isTransitioning: false }),
    }),
    {
      name: "deeting-theme-store",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        mode: state.mode,
      }),
    }
  )
);
