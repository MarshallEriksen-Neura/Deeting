export async function getDesktopConfig(key: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("get_desktop_config", { key });
}

export async function setDesktopConfig(
  key: string,
  value: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("set_desktop_config", { key, value });
}

export const DESKTOP_CONFIG_KEYS = {
  maxAgenticRounds: "max_agentic_rounds",
  personaPrompt: "chat.persona_prompt",
  workerWorkflowRouting: "workflow.route_worker_through_workflow",
  /** Persisted after login so desktop can call credits proxy with Authorization. */
  authToken: "auth.token",
  scoutBaseUrl: "scout.base_url",
} as const;

export async function getDesktopScoutBaseUrl(): Promise<string> {
  if (!isTauriRuntime()) return "";
  const { invoke } = await import("@tauri-apps/api/core");
  return (
    (await invoke<string | null>("get_effective_desktop_scout_base_url")) ?? ""
  );
}

export async function setDesktopScoutBaseUrl(value: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await setDesktopConfig(DESKTOP_CONFIG_KEYS.scoutBaseUrl, value.trim());
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

/** Persist auth token for Tauri so platform (credits) requests can use it. Call after login/refresh. */
export function persistAuthTokenForDesktop(accessToken: string): void {
  if (!isTauriRuntime()) return;
  const t = accessToken?.trim();
  if (!t) return;
  setDesktopConfig(DESKTOP_CONFIG_KEYS.authToken, t).catch(() => {});
}

/** Clear persisted auth token on logout (Tauri only). */
export function clearAuthTokenForDesktop(): void {
  if (!isTauriRuntime()) return;
  setDesktopConfig(DESKTOP_CONFIG_KEYS.authToken, "").catch(() => {});
}

/** Trigger platform models sync in Tauri (fire-and-forget). Call after login or on startup. */
export function syncPlatformModelsForDesktop(): void {
  if (!isTauriRuntime()) return;
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("sync_platform_models"))
    .catch(() => {});
}
