/** @jest-environment jsdom */

import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import { WechatPairingPanel } from "../wechat-pairing-panel"

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

    expect(screen.getByText("待处理配对 2")).toBeInTheDocument()
    expect(screen.getByText("已授权联系人 5")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("输入 6 位配对码"), {
      target: { value: "654321" },
    })
    fireEvent.click(screen.getByText("批准配对"))
    fireEvent.click(screen.getByText("拒绝配对"))

    expect(onPairingCodeChange).toHaveBeenCalledWith("654321")
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })
})
