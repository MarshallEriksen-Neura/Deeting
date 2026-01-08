"use client";

import { useEffect, useState } from "react";
import { useThemeStore } from "@/store/theme-store";

/**
 * 主题切换过渡遮罩组件
 * 在主题切换时显示一个柔和的遮罩层，实现平滑过渡
 */
export function ThemeTransitionOverlay() {
  const isTransitioning = useThemeStore((state) => state.isTransitioning);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isTransitioning) {
      setIsVisible(true);
      // 短暂延迟后开始动画，确保 DOM 已更新
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      // 等待淡出动画完成后移除元素
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isTransitioning]);

  if (!isVisible) return null;

  return (
    <div
      className={`
        fixed inset-0 z-[9999] pointer-events-none
        flex items-center justify-center
        transition-opacity duration-300 ease-out
        ${isAnimating ? "opacity-100" : "opacity-0"}
      `}
      aria-hidden="true"
    >
      {/* 毛玻璃遮罩背景 */}
      <div
        className={`
          absolute inset-0
          bg-[var(--background)]/80
          backdrop-blur-md
          transition-all duration-300 ease-out
          ${isAnimating ? "backdrop-blur-md" : "backdrop-blur-none"}
        `}
      />

      {/* 中心加载指示器 - iOS 风格 */}
      <div
        className={`
          relative z-10
          flex flex-col items-center gap-4
          transition-all duration-300 ease-out
          ${isAnimating ? "scale-100 opacity-100" : "scale-95 opacity-0"}
        `}
      >
        {/* 旋转光环 */}
        <div className="relative w-12 h-12">
          {/* 外环 */}
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--primary)]/60 border-r-[var(--primary)]/30 animate-spin"
            style={{ animationDuration: "0.8s" }}
          />
          {/* 内环发光 */}
          <div className="absolute inset-1 rounded-full bg-gradient-to-br from-[var(--primary)]/20 to-transparent animate-pulse" />
          {/* 中心点 */}
          <div className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-[var(--primary)]/80 shadow-[0_0_12px_rgba(124,109,255,0.6)]" />
        </div>

        {/* 切换文字提示 */}
        <span className="text-sm font-medium text-[var(--muted)] animate-pulse">
          切换主题中...
        </span>
      </div>

      {/* 装饰性光晕 */}
      <div
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-64 h-64
          bg-[radial-gradient(circle,var(--primary)/0.1,transparent)]
          rounded-full
          blur-3xl
          transition-opacity duration-500
          ${isAnimating ? "opacity-100" : "opacity-0"}
        `}
      />
    </div>
  );
}
