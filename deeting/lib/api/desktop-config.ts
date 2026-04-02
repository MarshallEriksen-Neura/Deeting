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
  chatHistoryRetentionDays: "chat.history_retention_days",
  workerWorkflowRouting: "workflow.route_worker_through_workflow",
  desktopWindowCloseAction: "desktop.window.close_action",
  /** Persisted after login so desktop can call credits proxy with Authorization. */
  authToken: "auth.token",
  desktopProxyMode: "network.proxy.mode",
  desktopProxyUrl: "network.proxy.url",
  scoutBaseUrl: "scout.base_url",
} as const;

export type DesktopProxyMode = "none" | "system" | "custom";
export type DesktopWindowCloseAction = "show_island" | "minimize" | "quit";

export interface DesktopNetworkProxySettings {
  mode: DesktopProxyMode;
  url: string;
}

export const DEFAULT_DESKTOP_WINDOW_CLOSE_ACTION: DesktopWindowCloseAction =
  "show_island";

export function normalizeDesktopProxyMode(
  value: string | null | undefined,
): DesktopProxyMode {
  switch (value?.trim().toLowerCase()) {
    case "none":
      return "none";
    case "custom":
      return "custom";
    default:
      return "system";
  }
}

export function normalizeDesktopWindowCloseAction(
  value: string | null | undefined,
): DesktopWindowCloseAction {
  switch (value?.trim().toLowerCase()) {
    case "minimize":
      return "minimize";
    case "quit":
      return "quit";
    default:
      return "show_island";
  }
}

export async function getDesktopWindowCloseActionPreference(): Promise<DesktopWindowCloseAction | null> {
  if (!isTauriRuntime()) return null;
  const value = await getDesktopConfig(
    DESKTOP_CONFIG_KEYS.desktopWindowCloseAction,
  );
  if (!value?.trim()) {
    return null;
  }
  return normalizeDesktopWindowCloseAction(value);
}

export async function getDesktopWindowCloseAction(): Promise<DesktopWindowCloseAction> {
  return (
    (await getDesktopWindowCloseActionPreference()) ??
    DEFAULT_DESKTOP_WINDOW_CLOSE_ACTION
  );
}

export async function setDesktopWindowCloseAction(
  value: DesktopWindowCloseAction,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await setDesktopConfig(
    DESKTOP_CONFIG_KEYS.desktopWindowCloseAction,
    normalizeDesktopWindowCloseAction(value),
  );
}

export async function getDesktopNetworkProxySettings(): Promise<DesktopNetworkProxySettings> {
  if (!isTauriRuntime()) {
    return { mode: "system", url: "" };
  }
  const [mode, url] = await Promise.all([
    getDesktopConfig(DESKTOP_CONFIG_KEYS.desktopProxyMode),
    getDesktopConfig(DESKTOP_CONFIG_KEYS.desktopProxyUrl),
  ]);
  return {
    mode: normalizeDesktopProxyMode(mode),
    url: url?.trim() ?? "",
  };
}

export async function setDesktopNetworkProxySettings(
  settings: DesktopNetworkProxySettings,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const normalizedMode = normalizeDesktopProxyMode(settings.mode);
  await Promise.all([
    setDesktopConfig(DESKTOP_CONFIG_KEYS.desktopProxyMode, normalizedMode),
    setDesktopConfig(
      DESKTOP_CONFIG_KEYS.desktopProxyUrl,
      settings.url.trim(),
    ),
  ]);
}

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
