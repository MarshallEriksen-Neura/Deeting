"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuthService } from "@/hooks/use-auth";
import {
  buildExternalLoginHostUrl,
  buildLoginHostRoute,
  normalizeAuthCallbackUrl,
  resolveCurrentAuthCallbackUrl,
} from "@/lib/auth/world-model";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";
import { useDesktopAuthBootstrapStore } from "@/store/desktop-auth-bootstrap-store";

const DESKTOP_EXTERNAL_LOGIN_URL = process.env.NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL ?? "";

function resolveDesktopLoginHostUrl(callbackUrl: string) {
  const configuredUrl = DESKTOP_EXTERNAL_LOGIN_URL.trim();

  if (configuredUrl) {
    return buildExternalLoginHostUrl({
      baseUrl: configuredUrl,
      callbackUrl,
    });
  }

  if (typeof window === "undefined") {
    return null;
  }

  const origin = window.location.origin.trim();
  if (!/^https?:\/\//i.test(origin)) {
    return null;
  }

  return buildExternalLoginHostUrl({
    baseUrl: buildLoginHostRoute(callbackUrl),
    callbackUrl,
    origin,
  });
}

export interface UseAuthWorldModelOptions {
  callbackUrl?: string | null;
}

export function useAuthWorldModel(options: UseAuthWorldModelOptions = {}) {
  const { callbackUrl } = options;
  const { startDesktopBrowserLogin } = useAuthService();
  const isDesktopAuthBootstrapReady = useDesktopAuthBootstrapStore((state) => state.isReady);
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
  const strategy = isDesktopRuntime ? "desktop_browser" : "web_route";
  const canRenderLoggedOutAction = !isDesktopRuntime || isDesktopAuthBootstrapReady;

  const launchLogin = useCallback(async () => {
    if (!isDesktopRuntime) {
      window.location.assign(loginTarget);
      return loginTarget;
    }

    const desktopLoginHostUrl = resolveDesktopLoginHostUrl(resolvedCallbackUrl);
    if (!desktopLoginHostUrl) {
      throw new Error(
        "Desktop browser login requires NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL or an http(s) web origin"
      );
    }

    setIsLaunchingLogin(true);
    try {
      await startDesktopBrowserLogin(desktopLoginHostUrl);
      return desktopLoginHostUrl;
    } finally {
      setIsLaunchingLogin(false);
    }
  }, [isDesktopRuntime, loginTarget, resolvedCallbackUrl, startDesktopBrowserLogin]);

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
