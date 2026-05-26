export function hasTauriCommandGlobals() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  )
}

export function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false
  }

  if (hasTauriCommandGlobals()) {
    return true
  }

  return process.env.NEXT_PUBLIC_IS_TAURI === "true"
}

export function isTauriCommandRuntime() {
  return process.env.NEXT_PUBLIC_IS_TAURI === "true" && hasTauriCommandGlobals()
}
