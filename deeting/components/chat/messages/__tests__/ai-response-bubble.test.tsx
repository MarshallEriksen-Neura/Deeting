import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIResponseBubble } from "@/components/chat/messages/ai-response-bubble";
import type { MessageBlock } from "@/lib/chat/message-protocol";

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}));

jest.mock("@/components/chat/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("@/hooks/chat/use-typewriter", () => ({
  useTypewriter: (content: string) => ({ displayed: content }),
}));

jest.mock("@/components/chat/visuals/status-visuals", () => ({
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
  it("does not show sandbox label for search_sdk console", () => {
    const parts: MessageBlock[] = [
      { id: "exec-title", type: "execution_section", title: "Local Tool Actions" },
      { id: "log-1", type: "console_log", stream: "stdout", content: "hello" },
      { id: "call-1", type: "tool_call", toolName: "search_sdk", status: "success" },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.queryByText("SANDBOX EXECUTION")).not.toBeInTheDocument();
    expect(screen.getByText("Local Tool Actions")).toBeInTheDocument();
  });

  it("shows sandbox label for execute_code_plan console", () => {
    const parts: MessageBlock[] = [
      { id: "exec-title", type: "execution_section", title: "Local Tool Actions" },
      { id: "log-1", type: "console_log", stream: "stdout", content: "hello" },
      { id: "call-1", type: "tool_call", toolName: "execute_code_plan", status: "success" },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getByText("SANDBOX EXECUTION")).toBeInTheDocument();
  });

  it("renders assistant transition card", () => {
    const parts: MessageBlock[] = [
      {
        id: "assistant-transition-1",
        type: "assistant_transition",
        action: "activated",
        assistantName: "Expert Planner",
        reason: "best match for this request",
      },
    ];

    render(<AIResponseBubble parts={parts} />);

    expect(screen.getByText("已切换到助手：Expert Planner")).toBeInTheDocument();
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

    fireEvent.click(screen.getByText("execute_code_plan"));
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

    fireEvent.click(screen.getByText("execute_code_plan"));
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
