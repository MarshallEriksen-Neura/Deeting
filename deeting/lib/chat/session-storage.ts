export function resolveSessionIdFromBrowser(
  storageKey: string,
  options?: { allowStorageFallback?: boolean }
): string | null {
  if (typeof window === "undefined") return null
  let querySessionId: string | null = null
  try {
    querySessionId =
      new URLSearchParams(window.location.search).get("session")?.trim() || null
  } catch {
    querySessionId = null
  }
  if (querySessionId) return querySessionId
  if (options?.allowStorageFallback === false) return null
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}
