export function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false
  }

  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
    return true
  }

  return process.env.NEXT_PUBLIC_IS_TAURI === "true"
}
