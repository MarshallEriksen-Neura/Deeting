"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth-store';
import { setAuthErrorCallback } from '@/http/client';

/**
 * useAuth hook - 便捷访问认证状态
 */
export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  const register = useAuthStore((state) => state.register);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    register,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const openAuthDialog = useAuthStore((state) => state.openAuthDialog);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // 应用启动时检查认证状态
    checkAuth();
    
    // 设置认证错误回调 - 当 API 返回 401 时触发
    setAuthErrorCallback(() => {
      // 打开登录对话框，而不是跳转到登录页
      openAuthDialog();
    });
    
    // 清理回调
    return () => {
      // setAuthErrorCallback(null);
    };
  }, [checkAuth, openAuthDialog, router, pathname]);

  return <>{children}</>;
}