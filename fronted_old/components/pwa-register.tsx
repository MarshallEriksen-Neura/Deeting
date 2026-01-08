'use client';

import { useEffect } from 'react';

export function PWARegister() {
  const registerSW = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('✅ Service Worker 注册成功:', registration.scope);
        
        // 检查更新
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            console.log('🔄 发现新版本 Service Worker');
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('✨ 新版本可用，请刷新页面');
              }
            });
          }
        });

        // 定期检查更新（每小时）
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch((error) => {
        console.error('❌ Service Worker 注册失败:', error);
      });
  };

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return;
    }

    // 延迟注册，避免阻塞页面加载
    if (document.readyState === 'complete') {
      registerSW();
      return;
    }

    window.addEventListener('load', registerSW);
    return () => window.removeEventListener('load', registerSW);
  }, []);

  return null;
}
