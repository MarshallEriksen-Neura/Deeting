"use client";

import { createContext, useContext, ReactNode } from 'react';
import { IPlatform } from './core/types';
import { webPlatform } from './adapters/web';
import { desktopPlatform } from './adapters/desktop';

// 简单的环境判断
const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === 'true';

// 选定当前环境的实现
const currentPlatform = isTauri ? desktopPlatform : webPlatform;

const PlatformContext = createContext<IPlatform>(currentPlatform);

export function PlatformProvider({ children }: { children: ReactNode }) {
  return (
    <PlatformContext.Provider value={currentPlatform}>
      {children}
    </PlatformContext.Provider>
  );
}

// 唯一的 Hook 入口
export const usePlatform = () => useContext(PlatformContext);
