'use client';

import { motion, type Transition } from 'framer-motion';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ComposerContextBarItem = {
  key: string;
  tone: 'default' | 'warning' | 'danger' | 'active';
  label: string;
  title?: string;
};

type ChatImmersiveComposerProps = {
  isEmpty: boolean;
  isBridgeFlashing: boolean;
  layoutTransition: Transition;
  contextBarItems: ComposerContextBarItem[];
  beforeInput?: ReactNode;
  children: ReactNode;
};

export function ChatImmersiveComposer({
  isEmpty,
  isBridgeFlashing,
  layoutTransition,
  contextBarItems,
  beforeInput,
  children,
}: ChatImmersiveComposerProps) {
  return (
    <motion.div
      layout="position"
      transition={{ layout: layoutTransition }}
      className={cn('relative pt-0.5', isEmpty && 'min-h-[94px] pt-0')}
    >
      {beforeInput}

      {contextBarItems.length > 0 ? (
        <motion.div
          layout="position"
          transition={{ layout: layoutTransition }}
          className="mb-2 flex flex-wrap items-center gap-1.5 px-1"
        >
          {contextBarItems.map((item) => (
            <span
              key={item.key}
              title={item.title}
              className={cn(
                'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium',
                item.tone === 'danger'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200'
                  : item.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200'
                    : item.tone === 'active'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200'
                      : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/65',
              )}
            >
              {item.label}
            </span>
          ))}
        </motion.div>
      ) : null}

      <div
        className={cn(
          'relative flex items-start rounded-[24px] border border-[#e1e4f3]/90 bg-white/72 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-white/[0.05] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
          isEmpty
            ? 'min-h-[92px] rounded-[26px] border-white/78 bg-white/64 px-4 py-3'
            : 'min-h-[72px] rounded-[24px]',
          isBridgeFlashing && 'terminal-bridge-flash',
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}
