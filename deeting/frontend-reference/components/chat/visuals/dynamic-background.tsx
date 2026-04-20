'use client';

import { memo } from 'react';

/**
 * DynamicBackground - 动态背景组件
 * 
 * 功能：
 * - 提供聊天界面的动态背景效果
 * - 支持亮色和暗色模式
 * - 使用渐变和模糊效果创建氛围感
 * 
 * 性能优化：
 * - 使用 React.memo 优化（纯展示组件，无 props）
 * - 使用 CSS 动画而非 JS 动画
 */
function DynamicBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* 
        Light Mode: Ambient Orbs on White 
        Dark Mode: Hidden or Subtle
      */}
      <div className="absolute inset-0 bg-[#F7F9FB] dark:bg-black transition-colors duration-500">
        
        {/* Orb 1: Top Left (Purple/Blue) */}
        <div className="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] bg-purple-200/25 dark:bg-purple-900/10 rounded-full blur-[80px] animate-pulse-slow mix-blend-multiply dark:mix-blend-normal" />
        
        {/* Orb 2: Bottom Right (Cyan/Teal) */}
        <div className="absolute -bottom-[10%] -right-[10%] w-[45vw] h-[45vw] bg-cyan-200/25 dark:bg-cyan-900/10 rounded-full blur-[100px] animate-pulse-slower mix-blend-multiply dark:mix-blend-normal" />

        {/* Orb 3: Center (Pink/Warm) - Moving */}
        <div className="absolute top-[30%] left-[30%] w-[30vw] h-[30vw] bg-pink-200/20 dark:bg-pink-900/5 rounded-full blur-[60px] animate-blob mix-blend-multiply dark:mix-blend-normal" />
        
      </div>
      
      {/* Gradient Overlay to soften edges */}
      <div className="absolute inset-0 bg-white/20 dark:bg-black/20 backdrop-blur-[1px]" />
    </div>
  );
}

// 使用 React.memo 优化，因为这是纯展示组件且没有 props
export default memo(DynamicBackground);
