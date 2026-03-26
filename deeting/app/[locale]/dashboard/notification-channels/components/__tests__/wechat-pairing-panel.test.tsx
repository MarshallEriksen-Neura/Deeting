/** @jest-environment jsdom */

import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import { WechatPairingPanel } from "../wechat-pairing-panel"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key
    const suffix = Object.entries(values)
      .map(([entryKey, entryValue]) => `${entryKey}:${String(entryValue)}`)
      .join(" ")
    return `${key} ${suffix}`.trim()
  },
}))

jest.mock("@/components/ui/glass-button", () => ({
  GlassButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

describe("WechatPairingPanel", () => {
  it("shows counts and forwards approve/reject actions", () => {
    const onApprove = jest.fn()
    const onReject = jest.fn()
    const onPairingCodeChange = jest.fn()

    render(
      <WechatPairingPanel
        pendingPairings={2}
        allowlistSize={5}
        pairingCode="123456"
        onPairingCodeChange={onPairingCodeChange}
        onApprove={onApprove}
        onReject={onReject}
      />
    )

    expect(screen.getByText("pendingPairings count:2")).toBeInTheDocument()
    expect(screen.getByText("allowlistSize count:5")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("codePlaceholder"), {
      target: { value: "654321" },
    })
    fireEvent.click(screen.getByText("approve"))
    fireEvent.click(screen.getByText("reject"))

    expect(onPairingCodeChange).toHaveBeenCalledWith("654321")
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })
})
