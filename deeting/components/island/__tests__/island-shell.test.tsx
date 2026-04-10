import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Message } from "@/lib/chat/message-types";
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store";
import { useChatStore } from "@/store/chat-store";
import { useChatRuntimeStore } from "@/store/chat-runtime-store";

import { IslandShell } from "../island-shell";
import { useIslandStore } from "../island-store";

const defaultHydrateFromChat = useIslandStore.getState().hydrateFromChat;

jest.mock("framer-motion", () => {
  type MockMotionDivProps = React.ComponentPropsWithoutRef<"div"> &
    Record<string, unknown>;
  type MockMotionButtonProps = React.ComponentPropsWithoutRef<"button"> &
    Record<string, unknown>;
  type MockMotionSpanProps = React.ComponentPropsWithoutRef<"span"> &
    Record<string, unknown>;
  const MOTION_KEYS = new Set([
    "layout",
    "whileHover",
    "whileTap",
    "animate",
    "initial",
    "exit",
    "transition",
    "variants",
  ]);

  function stripMotionProps<T extends Record<string, unknown>>(props: T) {
    return Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_KEYS.has(key)),
    ) as Omit<T, keyof typeof MOTION_KEYS>;
  }

  const MotionDiv = React.forwardRef<HTMLDivElement, MockMotionDivProps>(
    function MotionDiv({ children, ...props }, ref) {
      return (
        <div ref={ref} {...stripMotionProps(props)}>
          {children}
        </div>
      );
    },
  );

  const MotionButton = React.forwardRef<
    HTMLButtonElement,
    MockMotionButtonProps
  >(function MotionButton({ children, ...props }, ref) {
    return (
      <button ref={ref} {...stripMotionProps(props)}>
        {children}
      </button>
    );
  });

  const MotionSpan = React.forwardRef<HTMLSpanElement, MockMotionSpanProps>(
    function MotionSpan({ children, ...props }, ref) {
      return (
        <span ref={ref} {...stripMotionProps(props)}>
          {children}
        </span>
      );
    },
  );

  return {
    motion: {
      div: MotionDiv,
      button: MotionButton,
      span: MotionSpan,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

jest.mock("next-intl", () => ({
  useLocale: () => "en",
}));

jest.mock("@/components/chat/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) =>
    args.filter(Boolean).join(" "),
}));

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

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
    : undefined;

  useChatStore.setState({
    sessionId: "session-1",
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
        content: "",
        createdAt: 2,
        blocks: [
          {
            id: "assistant-1-text",
            type: "text",
            content: "Updated the roadmap based on your latest feedback.",
          },
        ] as Message["blocks"],
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
  });
  useChatRuntimeStore.setState({
    sessionId: "session-1",
    isLoading: false,
    globalLoading: false,
    statusStage: null,
    statusCode: null,
    statusMeta: null,
    errorMessage: null,
  });
  useBridgeApprovalStore.setState({
    queue: includeApproval
      ? [
          {
            kind: "bridge_mcp",
            approval_token: "approval-1",
            tool_name: "Shell Execute",
            arguments: {},
            description: "Run the migration script.",
            meta: {
              call_id: "call-1",
            },
          },
        ]
      : [],
    pending: includeApproval
      ? {
          kind: "bridge_mcp",
          approval_token: "approval-1",
          tool_name: "Shell Execute",
          arguments: {},
          description: "Run the migration script.",
          meta: {
            call_id: "call-1",
          },
        }
      : null,
    isApproving: false,
    recentApprovedExecution: null,
  });
}

describe("IslandShell", () => {
  beforeEach(() => {
    seedChatState(false);
    useChatRuntimeStore.setState({
      sessionId: "session-1",
      initialized: false,
      isLoading: false,
      globalLoading: false,
      activeMessageId: null,
      interruptedMessageId: null,
      statusMessageId: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      errorMessage: null,
      historyCursor: null,
      historyHasMore: false,
      pendingTakeover: null,
      pendingTakeoverRequestedAction: null,
    });
    useIslandStore.setState({
      mode: "collapsed",
      statusLabel: "Idle",
      summaryText: "",
      lastReplyText: "",
      recentMessages: [],
      pendingApproval: null,
      isBusy: false,
      errorMessage: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      stageHistory: [],
      hydrateFromChat: defaultHydrateFromChat,
    });
    useBridgeApprovalStore.getState().clearAll();
  });

  it("renders collapsed view from chat state", () => {
    render(<IslandShell />);
    expect(screen.getByText("island.status.ready")).toBeInTheDocument();
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument();
  });

  it("does not re-hydrate when only island state changes", () => {
    const originalHydrateFromChat = useIslandStore.getState().hydrateFromChat;
    const hydrateFromChatSpy = jest.fn(originalHydrateFromChat);
    useIslandStore.setState({ hydrateFromChat: hydrateFromChatSpy });

    render(<IslandShell />);
    expect(hydrateFromChatSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useIslandStore.getState().expand();
    });

    expect(hydrateFromChatSpy).toHaveBeenCalledTimes(1);
  });

  it("expands into a task-oriented island layout", () => {
    render(<IslandShell />);
    fireEvent.click(screen.getByText("island.status.ready"));

    expect(screen.getByText("island.requestLabel")).toBeInTheDocument();
    expect(screen.getByText("island.responseTitle")).toBeInTheDocument();
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument();
    expect(
      screen.getByText(/Updated the roadmap based on your latest feedback/),
    ).toBeInTheDocument();
    expect(screen.getByText("island.continueHere")).toBeInTheDocument();
  });

  it("shows approval card when chat state contains a pending approval", () => {
    seedChatState(true);
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    expect(screen.getAllByText("island.approvalTitle").length).toBeGreaterThan(0);
    expect(screen.getByText("Run the migration script.")).toBeInTheDocument();
    expect(screen.getByText("approvalDialog.actions.approve")).toBeInTheDocument();
    expect(screen.getByText("approvalDialog.actions.reject")).toBeInTheDocument();
  });

  it("auto-expands when approval arrives while collapsed", async () => {
    render(<IslandShell />);

    act(() => {
      seedChatState(true);
    });

    expect(await screen.findAllByText("island.approvalTitle")).toHaveLength(2);
    expect(useIslandStore.getState().mode).toBe("expanded");
  });

  it("shows quick reply input in expanded view", () => {
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    expect(
      screen.getByPlaceholderText("island.quickReplyPlaceholder"),
    ).toBeInTheDocument();
  });

  it("hides live progress when the island is idle", () => {
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    expect(screen.queryByText("island.liveProgress")).not.toBeInTheDocument();
    expect(screen.queryByText("status.flow.listen")).not.toBeInTheDocument();
  });

  it("shows live progress detail when chat status is active", () => {
    useChatRuntimeStore.setState({
      statusStage: "remember",
      statusCode: "context.loaded",
      statusMeta: { count: 3, has_summary: true },
    });
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    expect(screen.getByText("island.liveProgress")).toBeInTheDocument();
    expect(screen.getByText("status.flow.listen")).toBeInTheDocument();
    expect(screen.getByText("status.flow.remember")).toBeInTheDocument();
    expect(screen.queryByText("status.flow.evolve")).not.toBeInTheDocument();
    expect(screen.queryByText("status.flow.render")).not.toBeInTheDocument();
    expect(
      screen.getByText('status.detail.contextLoadedWithSummary:{"count":3}'),
    ).toBeInTheDocument();
  });

  it("humanizes running tool activity inside island progress", () => {
    useChatRuntimeStore.setState({
      statusStage: "render",
      statusCode: "approval.executing",
      statusMeta: { tool_name: "firecrawl_search" },
    });
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);

    expect(screen.getByText("status.flow.render")).toBeInTheDocument();
    expect(
      screen.getByText('status.detail.approvalExecuting:{"name":"Firecrawl Search"}'),
    ).toBeInTheDocument();
  });

  it("auto-collapses after a task completes", () => {
    jest.useFakeTimers();

    useChatRuntimeStore.setState({
      statusStage: "render",
      statusCode: "approval.executing",
      statusMeta: { tool_name: "firecrawl_search" },
    });
    useIslandStore.setState({ mode: "expanded" });

    render(<IslandShell />);

    act(() => {
      useChatRuntimeStore.setState({
        statusStage: null,
        statusCode: null,
        statusMeta: null,
      });
    });

    act(() => {
      jest.advanceTimersByTime(1800);
    });

    expect(useIslandStore.getState().mode).toBe("collapsed");

    expect(screen.getByText("island.status.completed")).toBeInTheDocument();
    expect(screen.getByText("island.completedDetail")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2600);
    });

    expect(screen.queryByText("island.status.completed")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("collapses back when collapse button is clicked", () => {
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    const allButtons = screen.getAllByRole("button");
    fireEvent.click(allButtons[0]);
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument();
  });

  it("renders nothing when mode is hidden", () => {
    useIslandStore.setState({ mode: "hidden" });
    const { container } = render(<IslandShell />);
    expect(container.firstChild).toBeNull();
  });

  it("hides approval card when no approval is pending", () => {
    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);
    expect(screen.queryByText("Approval required")).not.toBeInTheDocument();
    expect(screen.getByText("Q3 planning draft")).toBeInTheDocument();
  });

  it("keeps the latest assistant text visible in the main response panel", () => {
    const longAssistantReply =
      "This is a much longer island reply that should remain visible inside the main response panel instead of being reduced to a tiny transcript bubble.";
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
          content: "",
          createdAt: 2,
          blocks: [
            {
              id: "assistant-long-text",
              type: "text",
              content: longAssistantReply,
            },
          ] as Message["blocks"],
        },
      ] as unknown as Message[],
    });

    useIslandStore.setState({ mode: "expanded" });
    render(<IslandShell />);

    expect(screen.getByText(longAssistantReply)).toBeInTheDocument();
  });
});
