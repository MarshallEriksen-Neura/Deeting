"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildLoginHostRoute,
  normalizeAuthCallbackUrl,
  resolveCurrentAuthCallbackUrl,
} from "@/lib/auth/world-model";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";

export interface UseAuthWorldModelOptions {
  callbackUrl?: string | null;
}

export function useAuthWorldModel(options: UseAuthWorldModelOptions = {}) {
  const { callbackUrl } = options;
  const [isLaunchingLogin, setIsLaunchingLogin] = useState(false);
  const isDesktopRuntime = detectTauriRuntime();
  const resolvedCallbackUrl = useMemo(() => {
    if (callbackUrl?.trim()) {
      return normalizeAuthCallbackUrl(callbackUrl, "/");
    }

    return resolveCurrentAuthCallbackUrl("/");
  }, [callbackUrl]);
  const loginTarget = useMemo(
    () => buildLoginHostRoute(resolvedCallbackUrl),
    [resolvedCallbackUrl]
  );
  const strategy = isDesktopRuntime ? "local_only" : "web_route";
  const canRenderLoggedOutAction = !isDesktopRuntime;

  const launchLogin = useCallback(async () => {
    if (!isDesktopRuntime) {
      window.location.assign(loginTarget);
      return loginTarget;
    }

    setIsLaunchingLogin(true);
    try {
      throw new Error("Desktop login is disabled in local-only mode");
    } finally {
      setIsLaunchingLogin(false);
    }
  }, [isDesktopRuntime, loginTarget]);

  return {
    runtime: isDesktopRuntime ? ("desktop" as const) : ("web" as const),
    strategy,
    loginTarget,
    callbackUrl: resolvedCallbackUrl,
    canRenderLoggedOutAction,
    isLaunchingLogin,
    launchLogin,
  };
}
