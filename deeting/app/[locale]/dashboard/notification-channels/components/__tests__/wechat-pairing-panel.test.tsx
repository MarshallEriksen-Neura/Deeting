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
        allowlistContacts={["contact-a"]}
        contextContacts={["contact-b"]}
        pairingCode="123456"
        onPairingCodeChange={onPairingCodeChange}
        onUseContact={jest.fn()}
        onCopyContact={jest.fn()}
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

  it("renders contact chips and forwards contact selection", () => {
    const onUseContact = jest.fn()

    render(
      <WechatPairingPanel
        pendingPairings={0}
        allowlistSize={1}
        allowlistContacts={["contact-a"]}
        contextContacts={["contact-b"]}
        pairingCode=""
        onPairingCodeChange={jest.fn()}
        onUseContact={onUseContact}
        onCopyContact={jest.fn()}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "contact-a · approved" }))
    fireEvent.click(screen.getByRole("button", { name: "contact-b · hasContext" }))

    expect(onUseContact).toHaveBeenNthCalledWith(1, "contact-a")
    expect(onUseContact).toHaveBeenNthCalledWith(2, "contact-b")
  })

  it("forwards contact copy actions", () => {
    const onCopyContact = jest.fn()

    render(
      <WechatPairingPanel
        pendingPairings={0}
        allowlistSize={1}
        allowlistContacts={["contact-a"]}
        contextContacts={["contact-b"]}
        pairingCode=""
        onPairingCodeChange={jest.fn()}
        onUseContact={jest.fn()}
        onCopyContact={onCopyContact}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "copy contact-a" }))
    fireEvent.click(screen.getByRole("button", { name: "copy contact-b" }))

    expect(onCopyContact).toHaveBeenNthCalledWith(1, "contact-a")
    expect(onCopyContact).toHaveBeenNthCalledWith(2, "contact-b")
  })
})
