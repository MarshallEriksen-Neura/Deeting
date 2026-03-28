const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  if (args === undefined) {
    return invoke<T>(command)
  }
  return invoke<T>(command, args)
}

function assertDesktopRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("wechat connection is only available in desktop runtime")
  }
}

export interface LocalWechatPairingStartResult {
  pairing_id: string
  state: "qr_ready" | "connecting" | "connected" | "error"
  qr_image_url?: string
  qr_image_data?: string
  expires_at?: string
  account_label?: string
  error?: string
}

export interface LocalWechatPairingStatusResult {
  pairing_id: string
  state: "qr_ready" | "connecting" | "connected" | "cancelled" | "expired" | "error"
  qr_image_url?: string
  qr_image_data?: string
  expires_at?: string
  account_label?: string
  error?: string
}

export interface LocalWechatConnectionState {
  state: "disconnected" | "connecting" | "connected" | "error"
  account_label?: string
  last_error?: string
  connected_at?: string
  pending_pairings: number
  allowlist_size: number
  allowlist_contacts: string[]
  context_contacts: string[]
}

export interface LocalWechatDisconnectResult {
  success: boolean
  message: string
}

export interface LocalWechatPairingDecisionResult {
  success: boolean
  contact_id?: string
}

export interface LocalWechatCancelPairingResult {
  state: "cancelled"
}

export async function startLocalWechatPairing(): Promise<LocalWechatPairingStartResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatPairingStartResult>("start_local_wechat_pairing")
}

export async function getLocalWechatPairingStatus(
  pairingId: string
): Promise<LocalWechatPairingStatusResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatPairingStatusResult>("get_local_wechat_pairing_status", {
    pairingId,
  })
}

export async function cancelLocalWechatPairing(
  pairingId: string
): Promise<LocalWechatCancelPairingResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatCancelPairingResult>("cancel_local_wechat_pairing", {
    pairingId,
  })
}

export async function getLocalWechatConnectionState(
  channelId: string
): Promise<LocalWechatConnectionState> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatConnectionState>("get_local_wechat_connection_state", {
    channelId,
  })
}

export async function disconnectLocalWechatChannel(
  channelId: string
): Promise<LocalWechatDisconnectResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatDisconnectResult>("disconnect_local_wechat_channel", {
    channelId,
  })
}

export async function approveLocalWechatPairing(
  channelId: string,
  pairingCode: string
): Promise<LocalWechatPairingDecisionResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatPairingDecisionResult>("approve_local_wechat_pairing", {
    channelId,
    pairingCode,
  })
}

export async function rejectLocalWechatPairing(
  channelId: string,
  pairingCode: string
): Promise<LocalWechatPairingDecisionResult> {
  assertDesktopRuntime()
  return invokeTauri<LocalWechatPairingDecisionResult>("reject_local_wechat_pairing", {
    channelId,
    pairingCode,
  })
}
