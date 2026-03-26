/** @jest-environment jsdom */

import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import {
  WechatConnectDialog,
  type WechatConnectionViewState,
} from "../wechat-connect-dialog"

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function renderDialog(state: WechatConnectionViewState) {
  return render(
    <WechatConnectDialog
      open
      onOpenChange={jest.fn()}
      state={state}
      onStartConnect={jest.fn()}
      onReconnect={jest.fn()}
      onDisconnect={jest.fn()}
      onCancelPairing={jest.fn()}
    />
  )
}

describe("WechatConnectDialog", () => {
  it("shows the connect action in disconnected state", () => {
    renderDialog({ state: "disconnected" })

    expect(screen.getByText("连接微信")).toBeInTheDocument()
    expect(screen.getByText("扫码后将当前桌面实例与微信账号绑定。")).toBeInTheDocument()
  })

  it("shows qr guidance and cancel action while pairing", () => {
    renderDialog({
      state: "qr_ready",
      qrImageData: "data:image/png;base64,abc",
      expiresAt: "2026-03-26T00:10:00Z",
    })

    expect(screen.getByAltText("微信登录二维码")).toBeInTheDocument()
    expect(screen.getByText("请使用微信扫码登录")).toBeInTheDocument()
    expect(screen.getByText("取消扫码")).toBeInTheDocument()
  })

  it("shows reconnect and disconnect actions when connected", () => {
    const onReconnect = jest.fn()
    const onDisconnect = jest.fn()

    render(
      <WechatConnectDialog
        open
        onOpenChange={jest.fn()}
        state={{ state: "connected", accountLabel: "微信用户" }}
        onStartConnect={jest.fn()}
        onReconnect={onReconnect}
        onDisconnect={onDisconnect}
        onCancelPairing={jest.fn()}
      />
    )

    fireEvent.click(screen.getByText("重新连接"))
    fireEvent.click(screen.getByText("断开连接"))

    expect(screen.getByText("当前已连接账号")).toBeInTheDocument()
    expect(screen.getByText("微信用户")).toBeInTheDocument()
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })
})
