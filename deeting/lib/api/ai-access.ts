export type LocalAiAccessKeyStatus = "active" | "revoked" | string;

export interface LocalAiAccessKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  status: LocalAiAccessKeyStatus;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface LocalAiAccessKeyCreated {
  key: LocalAiAccessKeyRecord;
  secret: string;
}

export interface CreateLocalAiAccessKeyPayload {
  name: string;
  scopes?: string[];
}

export interface LocalAiAccessGatewayConfig {
  enabled: boolean;
  host: string;
  port: number;
  base_url: string | null;
}

export interface UpdateLocalAiAccessGatewayConfigPayload {
  enabled: boolean;
  host?: string;
  port?: number;
}

async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

export async function listLocalAiAccessKeys(): Promise<LocalAiAccessKeyRecord[]> {
  const invoke = await getInvoke();
  return invoke<LocalAiAccessKeyRecord[]>("list_local_ai_access_keys");
}

export async function createLocalAiAccessKey(
  payload: CreateLocalAiAccessKeyPayload,
): Promise<LocalAiAccessKeyCreated> {
  const invoke = await getInvoke();
  return invoke<LocalAiAccessKeyCreated>("create_local_ai_access_key", {
    payload: {
      name: payload.name,
      scopes: payload.scopes ?? [],
    },
  });
}

export async function revokeLocalAiAccessKey(id: string): Promise<boolean> {
  const invoke = await getInvoke();
  return invoke<boolean>("revoke_local_ai_access_key", { id });
}

export async function getLocalAiAccessGatewayConfig(): Promise<LocalAiAccessGatewayConfig> {
  const invoke = await getInvoke();
  return invoke<LocalAiAccessGatewayConfig>(
    "get_local_ai_access_gateway_config",
  );
}

export async function setLocalAiAccessGatewayConfig(
  payload: UpdateLocalAiAccessGatewayConfigPayload,
): Promise<LocalAiAccessGatewayConfig> {
  const invoke = await getInvoke();
  return invoke<LocalAiAccessGatewayConfig>(
    "set_local_ai_access_gateway_config",
    { payload },
  );
}

export async function startLocalAiAccessGateway(): Promise<LocalAiAccessGatewayConfig> {
  const invoke = await getInvoke();
  return invoke<LocalAiAccessGatewayConfig>("start_local_ai_access_gateway");
}

/**
 * Deterministic hue from a key id, used to give each row a unique identicon dot
 * so users can scan the list visually instead of reading prefixes.
 */
export function deriveKeyAccentHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * RFC3339 → relative phrase using Intl.RelativeTimeFormat. Returns null if the
 * input cannot be parsed so callers can fall back to a "never used" copy.
 */
export function formatRelativeTime(
  value: string | null | undefined,
  locale: string = "en-US",
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; secs: number }> = [
    { unit: "year", secs: 60 * 60 * 24 * 365 },
    { unit: "month", secs: 60 * 60 * 24 * 30 },
    { unit: "week", secs: 60 * 60 * 24 * 7 },
    { unit: "day", secs: 60 * 60 * 24 },
    { unit: "hour", secs: 60 * 60 },
    { unit: "minute", secs: 60 },
  ];
  for (const { unit, secs } of units) {
    if (absSeconds >= secs) {
      return rtf.format(Math.round(diffSeconds / secs), unit);
    }
  }
  return rtf.format(diffSeconds, "second");
}
