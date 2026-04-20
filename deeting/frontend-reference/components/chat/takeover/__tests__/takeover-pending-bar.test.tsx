import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import { TakeoverPendingBar } from "@/components/chat/takeover/takeover-pending-bar"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("TakeoverPendingBar", () => {
  it("renders the pending takeover preview and invokes all actions", () => {
    const onImmediateStop = jest.fn()
    const onSendAfterStep = jest.fn()
    const onCancel = jest.fn()

    render(
      <TakeoverPendingBar
        pendingTakeover={{
          input: "follow-up prompt",
          attachments: [],
          selectedKnowledgeFileIds: ["doc-1"],
          createdAt: 1,
          updatedAt: 1,
        }}
        onImmediateStop={onImmediateStop}
        onSendAfterStep={onSendAfterStep}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText("takeover.title")).toBeInTheDocument()
    expect(screen.getByText("follow-up prompt")).toBeInTheDocument()

    fireEvent.click(screen.getByText("takeover.actions.immediateStop"))
    fireEvent.click(screen.getByText("takeover.actions.sendAfterStep"))
    fireEvent.click(screen.getAllByText("takeover.actions.cancel")[0])

    expect(onImmediateStop).toHaveBeenCalledTimes(1)
    expect(onSendAfterStep).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("does not render without a pending takeover", () => {
    const { container } = render(
      <TakeoverPendingBar
        pendingTakeover={null}
        onImmediateStop={jest.fn()}
        onSendAfterStep={jest.fn()}
        onCancel={jest.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
