/** @jest-environment jsdom */

import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import {
  WechatConnectDialog,
  type WechatConnectionViewState,
} from "../wechat-connect-dialog"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key
    const suffix = Object.entries(values)
      .map(([entryKey, entryValue]) => `${entryKey}:${String(entryValue)}`)
      .join(" ")
    return `${key} ${suffix}`.trim()
  },
}))

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

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
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

    expect(screen.getByText("actions.connect")).toBeInTheDocument()
    expect(screen.getByText("disconnected.description")).toBeInTheDocument()
  })

  it("shows qr guidance and cancel action while pairing", () => {
    renderDialog({
      state: "qr_ready",
      qrImageData: "data:image/png;base64,abc",
      expiresAt: "2026-03-26T00:10:00Z",
    })

    expect(screen.getByAltText("qrReady.qrAlt")).toBeInTheDocument()
    expect(screen.getByText("qrReady.title")).toBeInTheDocument()
    expect(screen.getByText("actions.cancelScan")).toBeInTheDocument()
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

    fireEvent.click(screen.getByText("actions.reconnect"))
    fireEvent.click(screen.getByText("actions.disconnect"))

    expect(screen.getByText("connected.currentAccount")).toBeInTheDocument()
    expect(screen.getByText("微信用户")).toBeInTheDocument()
    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })
})
