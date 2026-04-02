import { fireEvent, render, screen } from "@testing-library/react"

import { useChatStore } from "@/store/chat-store"

import { IslandShell } from "../island-shell"
import { useIslandStore } from "../island-store"

jest.mock("framer-motion", () => {
  const React = require("react")
  return {
    motion: {
      div: React.forwardRef(
        ({ children, layout, ...props }: any, ref: any) => (
          <div ref={ref} {...props}>
            {children}
          </div>
        )
      ),
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

jest.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}))

function seedChatState(includeApproval = false) {
  const assistantMessageBlocks = includeApproval
    ? [
        {
          id: "tool-result-1",
          type: "tool_result",
          callId: "call-1",
          toolName: "shell.exec",
          status: "requires_approval",
          result: {
            status: "REQUIRES_APPROVAL",
            approval_token: "approval-1",
            tool_name: "shell.exec",
            description: "Run the migration script.",
          },
        },
      ]
    : undefined

  useChatStore.setState({
    sessionId: "session-1",
    selectedAssistant: { id: "assistant-1", name: "Planner", desc: "", color: "#000" },
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "Q3 planning draft",
        createdAt: 1,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Updated the roadmap based on your latest feedback.",
        createdAt: 2,
      },
      ...(includeApproval
        ? [
            {
              id: "assistant-2",
              role: "assistant",
              content: "",
              createdAt: 3,
              blocks: assistantMessageBlocks as any,
            },
          ]
        : []),
    ] as any,
    isLoading: false,
    globalLoading: false,
    statusCode: null,
    errorMessage: null,
  })
}

describe("IslandShell", () => {
  beforeEach(() => {
    seedChatState(false)
    useIslandStore.setState({
      mode: "collapsed",
      statusLabel: "Idle",
      summaryText: "",
      lastReplyText: "",
      pendingApproval: null,
      isBusy: false,
      errorMessage: null,
    })
  })

  it("renders collapsed view from chat state", () => {
    render(<IslandShell />)
    expect(screen.getByText("Ready")).toBeInTheDocument()
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument()
  })

  it("expands when collapsed view is clicked", () => {
    render(<IslandShell />)
    fireEvent.click(screen.getByText("Ready"))
    expect(screen.getByText("Latest reply")).toBeInTheDocument()
    expect(
      screen.getByText(/Updated the roadmap based on your latest feedback/)
    ).toBeInTheDocument()
  })

  it("shows approval card when chat state contains a pending approval", () => {
    seedChatState(true)
    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)
    expect(screen.getByText("Approval required")).toBeInTheDocument()
    expect(screen.getByText("shell.exec")).toBeInTheDocument()
    expect(screen.getByText("Approve")).toBeInTheDocument()
    expect(screen.getByText("Reject")).toBeInTheDocument()
  })

  it("shows quick reply input in expanded view", () => {
    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)
    expect(screen.getByPlaceholderText("Quick reply…")).toBeInTheDocument()
  })

  it("collapses back when collapse button is clicked", () => {
    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)
    const allButtons = screen.getAllByRole("button")
    fireEvent.click(allButtons[0])
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument()
  })

  it("renders nothing when mode is hidden", () => {
    useIslandStore.setState({ mode: "hidden" })
    const { container } = render(<IslandShell />)
    expect(container.firstChild).toBeNull()
  })

  it("hides approval card when no approval is pending", () => {
    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)
    expect(screen.queryByText("Approval required")).not.toBeInTheDocument()
    expect(screen.getByText("Latest reply")).toBeInTheDocument()
  })
})
