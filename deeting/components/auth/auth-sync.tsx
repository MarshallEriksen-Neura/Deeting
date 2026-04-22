"use client";

import { useEffect } from "react";
import { clearAuthTokenForDesktop } from "@/lib/api/desktop-config";
import { AUTH_INVALIDATED_EVENT, setAuthToken } from "@/lib/http";
import { useAuthStore } from "@/store/auth-store";

export function AuthSync() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearSession = useAuthStore((state) => state.clearSession);

  useEffect(() => {
    setAuthToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    const handleInvalidated = () => {
      clearAuthTokenForDesktop();
      clearSession();
    };

    window.addEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated);
    return () => {
      window.removeEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated);
    };
  }, [clearSession]);

  return null;
}
