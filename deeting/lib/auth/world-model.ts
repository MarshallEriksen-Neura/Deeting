export const LOGIN_HOST_ROUTE = "/login";

function normalizeLoginPathname(value: string) {
  const [pathname] = value.split("?");
  const trimmed = pathname.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || "/";
}

export function isLoginHostRoute(value: string) {
  const pathname = normalizeLoginPathname(value);
  return pathname === LOGIN_HOST_ROUTE || /\/login$/.test(pathname);
}

export function normalizeAuthCallbackUrl(
  value: string | null | undefined,
  fallback = "/"
) {
  const normalizedFallback = fallback.trim() || "/";
  const candidate = value?.trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return normalizedFallback;
  }

  if (isLoginHostRoute(candidate)) {
    return normalizedFallback;
  }

  return candidate;
}

export function buildLoginHostRoute(callbackUrl?: string | null) {
  const normalizedCallback = normalizeAuthCallbackUrl(callbackUrl, "/");

  if (normalizedCallback === "/") {
    return LOGIN_HOST_ROUTE;
  }

  return `${LOGIN_HOST_ROUTE}?callbackUrl=${encodeURIComponent(normalizedCallback)}`;
}

export function resolveCurrentAuthCallbackUrl(fallback = "/") {
  if (typeof window === "undefined") {
    return fallback;
  }

  return normalizeAuthCallbackUrl(
    `${window.location.pathname}${window.location.search || ""}`,
    fallback
  );
}

export function buildExternalLoginHostUrl(options: {
  baseUrl: string;
  callbackUrl?: string | null;
  origin?: string;
}) {
  const { baseUrl, callbackUrl, origin } = options;
  const normalizedBaseUrl = baseUrl.trim();

  if (!normalizedBaseUrl) {
    return null;
  }

  try {
    const target = origin ? new URL(normalizedBaseUrl, origin) : new URL(normalizedBaseUrl);
    const normalizedCallback = normalizeAuthCallbackUrl(callbackUrl, "/");

    if (normalizedCallback === "/") {
      target.searchParams.delete("callbackUrl");
    } else {
      target.searchParams.set("callbackUrl", normalizedCallback);
    }

    return target.toString();
  } catch {
    return null;
  }
}
