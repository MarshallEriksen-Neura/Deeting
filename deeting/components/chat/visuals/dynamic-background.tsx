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
      <div className="absolute inset-0 bg-[#fbfdff] transition-colors duration-500 dark:bg-zinc-950">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(231,244,255,0.62)_0%,rgba(255,255,255,0.9)_38%,rgba(248,245,255,0.62)_69%,rgba(255,250,253,0.76)_100%)] dark:bg-[linear-gradient(115deg,rgba(23,23,23,0.98),rgba(28,25,39,0.92))]" />
        <div className="absolute inset-x-[10%] top-[8%] h-[40%] bg-[linear-gradient(90deg,rgba(154,203,255,0.1),rgba(146,118,229,0.08),rgba(255,255,255,0))] blur-[74px] dark:opacity-25" />
        <div className="absolute inset-x-[18%] bottom-[0%] h-[42%] bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(198,226,255,0.16),rgba(239,219,255,0.12),rgba(255,255,255,0))] blur-[88px] dark:opacity-20" />
      </div>
      
      {/* Gradient Overlay to soften edges */}
      <div className="absolute inset-0 bg-white/18 backdrop-blur-[1px] dark:bg-zinc-950/20" />
    </div>
  );
}

// 使用 React.memo 优化，因为这是纯展示组件且没有 props
export default memo(DynamicBackground);
