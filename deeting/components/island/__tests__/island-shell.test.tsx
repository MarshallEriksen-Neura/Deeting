import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"

import type { Message } from "@/lib/chat/message-types"
import { useChatStore } from "@/store/chat-store"

import { IslandShell } from "../island-shell"
import { useIslandStore } from "../island-store"

jest.mock("framer-motion", () => {
  type MockMotionDivProps = React.ComponentPropsWithoutRef<"div"> & Record<string, unknown>
  type MockMotionButtonProps = React.ComponentPropsWithoutRef<"button"> & Record<string, unknown>
  type MockMotionSpanProps = React.ComponentPropsWithoutRef<"span"> & Record<string, unknown>
  const MOTION_KEYS = new Set([
    "layout",
    "whileHover",
    "whileTap",
    "animate",
    "initial",
    "exit",
    "transition",
    "variants",
  ])

  function stripMotionProps<T extends Record<string, unknown>>(props: T) {
    return Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_KEYS.has(key))
    ) as Omit<T, keyof typeof MOTION_KEYS>
  }

  const MotionDiv = React.forwardRef<HTMLDivElement, MockMotionDivProps>(function MotionDiv(
    { children, ...props },
    ref
  ) {
    return (
      <div ref={ref} {...stripMotionProps(props)}>
        {children}
      </div>
    )
  })

  const MotionButton = React.forwardRef<HTMLButtonElement, MockMotionButtonProps>(
    function MotionButton({ children, ...props }, ref) {
      return (
        <button ref={ref} {...stripMotionProps(props)}>
          {children}
        </button>
      )
    }
  )

  const MotionSpan = React.forwardRef<HTMLSpanElement, MockMotionSpanProps>(function MotionSpan(
    { children, ...props },
    ref
  ) {
    return (
      <span ref={ref} {...stripMotionProps(props)}>
        {children}
      </span>
    )
  })

  return {
    motion: {
      div: MotionDiv,
      button: MotionButton,
      span: MotionSpan,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

jest.mock("next-intl", () => ({
  useLocale: () => "en",
}))

jest.mock("@/components/chat/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}))

jest.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}))

jest.mock("@/hooks/use-i18n", () => ({
  useI18n:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
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
              blocks: assistantMessageBlocks as Message["blocks"],
            },
          ]
        : []),
    ] as unknown as Message[],
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
    expect(screen.queryByText("Latest reply")).not.toBeInTheDocument()
    expect(screen.getByText("You")).toBeInTheDocument()
    expect(screen.getByText("Deeting")).toBeInTheDocument()
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument()
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

  it("shows live progress detail when chat status is active", () => {
    useChatStore.setState({
      statusStage: "remember",
      statusCode: "context.loaded",
      statusMeta: { count: 3, has_summary: true },
    })
    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)
    expect(screen.getByText("Live progress")).toBeInTheDocument()
    expect(
      screen.getByText('status.detail.contextLoadedWithSummary:{"count":3}')
    ).toBeInTheDocument()
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
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument()
  })

  it("keeps expanded transcript message text instead of truncating it to a short preview", () => {
    const longAssistantReply =
      "This is a much longer island reply that should remain visible in the expanded transcript instead of being reduced to a tiny recent preview line for the user."
    useChatStore.setState({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Please explain the tradeoffs in detail.",
          createdAt: 1,
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: longAssistantReply,
          createdAt: 2,
        },
      ] as unknown as Message[],
    })

    useIslandStore.setState({ mode: "expanded" })
    render(<IslandShell />)

    expect(screen.getByText(longAssistantReply)).toBeInTheDocument()
  })
})
