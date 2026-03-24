import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIResponseBubble } from "@/components/chat/messages/ai-response-bubble";
import type { MessageBlock } from "@/lib/chat/message-protocol";

const terminalStreamMock = jest.fn();

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}));

jest.mock("@/components/chat/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => {
    const React = require("react");
    const ViewBlock = require("@/components/views/view-block").default;
    return function DynamicViewBlock(props: Record<string, unknown>) {
      return React.createElement(ViewBlock, props);
    };
  },
}));

jest.mock("@/components/views/view-block", () => ({
  __esModule: true,
  default: ({
    viewType,
    payload,
    title,
  }: {
    viewType: string;
    payload: unknown;
    title?: string;
  }) => <div data-testid="view-block">{`${title ?? viewType}:${JSON.stringify(payload)}`}</div>,
}));

jest.mock("@/hooks/chat/use-typewriter", () => ({
  useTypewriter: (content: string) => ({ displayed: content }),
}));

jest.mock("@/components/chat/visuals/status-visuals", () => ({
  TerminalStream: (props: Record<string, unknown>) => {
    terminalStreamMock(props);
    return <div data-testid="terminal-stream" />;
  },
  StatusStream: () => <div data-testid="status-stream" />,
  HolographicPulse: () => <div data-testid="holographic-pulse" />,
  GhostCursor: () => <div data-testid="ghost-cursor" />,
  useStepProgress: () => 0,
  resolveStageIndex: () => 0,
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe("AIResponseBubble debug panel", () => {
  beforeEach(() => {
    terminalStreamMock.mockClear();
  });

  it("keeps terminal stream visible in compact mode after content appears", () => {
    const parts: MessageBlock[] = [{ id: "text-1", type: "text", content: "hello" }];

    render(
      <AIResponseBubble
        parts={parts}
        isActive
        streamEnabled
        statusStage="listen"
      />
    );

    expect(screen.getByTestId("terminal-stream")).toBeInTheDocument();
  });

  it("shows a lightweight waiting state before the call chain is revealed", () => {
    render(
      <AIResponseBubble
        parts={[]}
        isActive
        streamEnabled
        statusStage="listen"
      />
    );

    const latestCall = terminalStreamMock.mock.calls[terminalStreamMock.mock.calls.length - 1];
    const latestProps = latestCall?.[0] as
      | { showPlaceholder?: boolean; placeholder?: string; statusLabel?: string }
      | undefined;

    expect(latestProps?.showPlaceholder).toBe(true);
    expect(latestProps?.placeholder).toBe("status.placeholder.waiting");
    expect(latestProps?.statusLabel).toBe("status.header.answering");
  });

  it("keeps terminal stream visible when a tool-linked ui block is present", () => {
    const parts: MessageBlock[] = [
      { id: "tool-1", type: "tool_call", callId: "call-1", toolName: "search_sdk", status: "success" },
      {
        id: "result-1",
        type: "tool_result",
        callId: "call-1",
        toolName: "search_sdk",
        status: "success",
        result: { ok: true },
      },
      {
        id: "ui-1",
        type: "ui",
        callId: "call-1",
        toolName: "search_sdk",
        viewType: "table.simple",
        title: "Execution Table",
        payload: { rows: [{ name: "Alice" }] },
      },
    ];

    render(<AIResponseBubble parts={parts} isActive streamEnabled statusStage="render" />);

    expect(screen.getByTestId("terminal-stream")).toBeInTheDocument();
    expect(screen.getByText("SDK Search")).toBeInTheDocument();
    expect(screen.getByTestId("view-block")).toBeInTheDocument();
  });

  it("groups active multi-tool calls into one live block", () => {
    const parts: MessageBlock[] = [
      { id: "tool-1", type: "tool_call", toolName: "search_sdk", status: "success" },
      { id: "tool-2", type: "tool_call", toolName: "execute_code_plan", status: "running" },
    ];

    render(<AIResponseBubble parts={parts} isActive />);

    expect(screen.getByText("toolGroup.liveSkillSummary")).toBeInTheDocument();
    expect(screen.getByText("SDK Search")).toBeInTheDocument();
  });

  it("renders tool-linked ui inside the matching tool block without duplicating the widget", () => {
    const parts: MessageBlock[] = [
      { id: "tool-1", type: "tool_call", callId: "call-ui-1", toolName: "search_sdk", status: "success" },
      {
        id: "result-ui-1",
        type: "tool_result",
        callId: "call-ui-1",
        toolName: "search_sdk",
        status: "success",
        result: { summary: "done" },
      },
      {
        id: "ui-linked-1",
        type: "ui",
        callId: "call-ui-1",
        toolName: "search_sdk",
        viewType: "table.simple",
        title: "Execution Table",
        payload: { rows: [{ name: "Alice" }] },
      },
      {
        id: "ui-standalone-1",
        type: "ui",
        viewType: "chart.line",
        title: "Standalone Chart",
        payload: { points: [1, 2, 3] },
      },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getAllByTestId("view-block")).toHaveLength(2);
    expect(screen.getByText('Execution Table:{"rows":[{"name":"Alice"}]}')).toBeInTheDocument();
    expect(screen.getByText('Standalone Chart:{"points":[1,2,3]}')).toBeInTheDocument();
  });

  it("forwards repeat_count from status meta to terminal stream", () => {
    render(
      <AIResponseBubble
        parts={[]}
        isActive
        streamEnabled
        statusStage="listen"
        statusCode="upstream.streaming"
        statusMeta={{ repeat_count: 5 }}
      />
    );

    const latestCall = terminalStreamMock.mock.calls[terminalStreamMock.mock.calls.length - 1];
    const latestProps = latestCall?.[0] as
      | { detailRepeat?: number; showPlaceholder?: boolean }
      | undefined;
    expect(latestProps?.detailRepeat).toBe(5);
    expect(latestProps?.showPlaceholder).toBe(true);
  });

  it("switches the status pill label to completed after the response finishes", () => {
    const parts: MessageBlock[] = [{ id: "text-1", type: "text", content: "done" }];

    render(<AIResponseBubble parts={parts} />);

    const latestCall = terminalStreamMock.mock.calls[terminalStreamMock.mock.calls.length - 1];
    const latestProps = latestCall?.[0] as
      | { completed?: boolean; statusLabel?: string }
      | undefined;

    expect(latestProps?.completed).toBe(true);
    expect(latestProps?.statusLabel).toBe("status.header.completed");
  });

  it("does not show sandbox label for search_sdk console", () => {
    const parts: MessageBlock[] = [
      { id: "call-1", type: "tool_call", toolName: "search_sdk", status: "success" },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.queryByText("SANDBOX EXECUTION")).not.toBeInTheDocument();
    expect(screen.queryByText("Code Execution")).not.toBeInTheDocument();
    expect(screen.getByText("SDK Search")).toBeInTheDocument();
  });

  it("shows sandbox label for execute_code_plan console", () => {
    const parts: MessageBlock[] = [
      { id: "exec-title", type: "execution_section", title: "Code Execution" },
      { id: "log-1", type: "console_log", stream: "stdout", content: "hello" },
      { id: "call-1", type: "tool_call", toolName: "execute_code_plan", status: "success" },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getByText("SANDBOX EXECUTION")).toBeInTheDocument();
  });

  it("keeps sandbox label scoped to the matching console sequence", () => {
    const parts: MessageBlock[] = [
      { id: "call-1", type: "tool_call", toolName: "search_sdk", status: "success" },
      { id: "exec-title-2", type: "execution_section", title: "Code Execution" },
      { id: "log-2", type: "console_log", stream: "stdout", content: "exec log" },
      { id: "call-2", type: "tool_call", toolName: "execute_code_plan", status: "success" },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getByText("SANDBOX EXECUTION")).toBeInTheDocument();
    expect(screen.getByText("SDK Search")).toBeInTheDocument();
  });

  it("renders capability transition card", () => {
    const parts: MessageBlock[] = [
      {
        id: "assistant-transition-1",
        type: "capability_transition",
        action: "activated",
        capabilityName: "Expert Planner",
        reason: "best match for this request",
      },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getByText("已启用专家能力：Expert Planner")).toBeInTheDocument();
    expect(screen.getByText("best match for this request")).toBeInTheDocument();
  });

  it("renders runtime tool timeline from tool_result.debug", () => {
    const parts: MessageBlock[] = [
      {
        id: "tool-result-1",
        type: "tool_result",
        toolName: "execute_code_plan",
        status: "success",
        result: "ok",
        debug: {
          execution_id: "exec_0011223344",
          runtime_tool_calls: {
            count: 2,
            calls: [
              { index: 0, tool_name: "search_web", status: "success" },
              {
                index: 1,
                tool_name: "send_alert",
                status: "failed",
                duration_ms: 42,
                error: "tool timeout",
                error_code: "UPSTREAM_TIMEOUT",
              },
            ],
          },
          render_blocks: {
            count: 1,
          },
          sdk_stub: {
            module: "deeting_sdk",
            tool_count: 4,
          },
        },
      },
    ];

    render(<AIResponseBubble parts={parts} />);

    fireEvent.click(screen.getByText("Code Execution"));
    fireEvent.click(screen.getByText("Debug"));

    expect(screen.getByText("Runtime Tool Timeline")).toBeInTheDocument();
    expect(screen.getByText("#0 search_web")).toBeInTheDocument();
    expect(screen.getByText("#1 send_alert")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByText("[UPSTREAM_TIMEOUT] tool timeout")).toBeInTheDocument();
    expect(screen.getByText("calls:2")).toBeInTheDocument();
    expect(screen.getByText("render:1")).toBeInTheDocument();
    expect(screen.getByText("sdk:deeting_sdk(4)")).toBeInTheDocument();
  });

  it("copies debug snapshot JSON", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const parts: MessageBlock[] = [
      {
        id: "tool-result-copy",
        type: "tool_result",
        toolName: "execute_code_plan",
        status: "success",
        result: "ok",
        debug: { execution_id: "exec_copy_1" },
      },
    ];

    render(<AIResponseBubble parts={parts} />);

    fireEvent.click(screen.getByText("Code Execution"));
    fireEvent.click(screen.getByText("Debug"));
    fireEvent.click(screen.getByText("Copy JSON"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify({ execution_id: "exec_copy_1" }, null, 2)
    );
  });
});
