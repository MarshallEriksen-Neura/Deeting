'use client';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

export default function ControlsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCoder = pathname?.includes('/coder');
  const isImage = pathname?.includes('/create/image');

  // 图片页面：使用沉浸式布局，FloatingConsole 占满宽度
  if (isImage) {
    return (
      <div className="w-full">
        {children}
      </div>
    );
  }

  // Morphing Styles
  // Default: Capsule
  // Dark Mode: "bg-black/40 backdrop-blur-2xl border-white/10" (Preserved)
  // Light Mode: "bg-white/70 backdrop-blur-2xl border-white/50 shadow-xl" (New Crystal Look)
  let containerClasses = "bg-white/70 dark:bg-black/40 backdrop-blur-2xl rounded-[32px] border border-white/50 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-none"; 
  let animateProps = { height: 'auto', borderRadius: '32px' };
  let overflowClass = "overflow-visible"; // Allow popups in default mode

  if (isCoder) {
    // Console: Rectangular, Taller
    // Light: White glassy, Dark: Deep charcoal
    containerClasses = "bg-white/80 dark:bg-[#1e1e1e]/95 backdrop-blur-xl border border-green-600/20 dark:border-green-500/20 shadow-xl dark:shadow-green-900/10";
    animateProps = { height: 200, borderRadius: '12px' }; 
    overflowClass = "overflow-hidden";
  } else if (isImage) {
    // Dashboard: Large, Soft Rect
    // Light: White glassy, Dark: Zinc-900
    containerClasses = "bg-white/80 dark:bg-zinc-900/95 backdrop-blur-xl border border-purple-600/20 dark:border-purple-500/20 shadow-xl dark:shadow-purple-900/10";
    animateProps = { height: 240, borderRadius: '24px' }; 
    overflowClass = "overflow-hidden";
  }

  return (
    <div className="w-full flex justify-center perspective-[1000px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={isCoder ? 'coder' : isImage ? 'image' : 'default'}
          layoutId="controls-container"
          initial={{ opacity: 0, y: 20, scale: 0.9, ...animateProps }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            ...animateProps
          }}
          exit={{ opacity: 0, y: -10, scale: 0.95, filter: 'blur(10px)' }}
          transition={{ 
            type: "spring", 
            stiffness: 350, 
            damping: 30,
            // layout: { duration: 0.4 } // Let spring handle it
          }}
          className={`
            relative w-full border shadow-2xl transition-all duration-500
            ${overflowClass}
            ${containerClasses}
          `}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
