/** @jest-environment jsdom */

import {
  approveLocalWechatPairing,
  cancelLocalWechatPairing,
  disconnectLocalWechatChannel,
  getLocalWechatConnectionState,
  getLocalWechatPairingStatus,
  rejectLocalWechatPairing,
  startLocalWechatPairing,
} from "../wechat-connection"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("wechat connection api", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockReset()
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("starts local wechat pairing in tauri runtime", async () => {
    mockInvoke.mockResolvedValue({
      pairing_id: "pair-1",
      state: "qr_ready",
      qr_image_data: "data:image/png;base64,abc",
      expires_at: "2026-03-26T00:10:00Z",
    } as never)

    const result = await startLocalWechatPairing()

    expect(result.pairing_id).toBe("pair-1")
    expect(mockInvoke).toHaveBeenCalledWith("start_local_wechat_pairing")
  })

  it("queries pairing status by pairing id", async () => {
    mockInvoke.mockResolvedValue({
      pairing_id: "pair-1",
      state: "connected",
      account_label: "微信用户",
    } as never)

    const result = await getLocalWechatPairingStatus("pair-1")

    expect(result.state).toBe("connected")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_wechat_pairing_status", {
      pairingId: "pair-1",
    })
  })

  it("loads connection state, disconnects, and manages pairing approvals", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        state: "connected",
        account_label: "微信用户",
        pending_pairings: 1,
        allowlist_size: 2,
      } as never)
      .mockResolvedValueOnce({
        success: true,
        message: "ok",
      } as never)
      .mockResolvedValueOnce({
        success: true,
        contact_id: "wx-user-1",
      } as never)
      .mockResolvedValueOnce({
        success: true,
      } as never)
      .mockResolvedValueOnce({
        state: "cancelled",
      } as never)

    const state = await getLocalWechatConnectionState("channel-1")
    const disconnected = await disconnectLocalWechatChannel("channel-1")
    const approved = await approveLocalWechatPairing("channel-1", "123456")
    const rejected = await rejectLocalWechatPairing("channel-1", "654321")
    const cancelled = await cancelLocalWechatPairing("pair-1")

    expect(state.allowlist_size).toBe(2)
    expect(disconnected.success).toBe(true)
    expect(approved.contact_id).toBe("wx-user-1")
    expect(rejected.success).toBe(true)
    expect(cancelled.state).toBe("cancelled")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_wechat_connection_state", {
      channelId: "channel-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "disconnect_local_wechat_channel", {
      channelId: "channel-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "approve_local_wechat_pairing", {
      channelId: "channel-1",
      pairingCode: "123456",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "reject_local_wechat_pairing", {
      channelId: "channel-1",
      pairingCode: "654321",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(5, "cancel_local_wechat_pairing", {
      pairingId: "pair-1",
    })
  })
})
