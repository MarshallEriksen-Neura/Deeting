import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { RunnableCodeFence } from "@/components/chat/runnable-code-fence"
import { runLocalSandboxCodeSnippet } from "@/lib/api/sandbox"
import { useChatStore } from "@/store/chat-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/sandbox", () => ({
  runLocalSandboxCodeSnippet: jest.fn(),
}))

const mockRunLocalSandboxCodeSnippet =
  runLocalSandboxCodeSnippet as jest.MockedFunction<typeof runLocalSandboxCodeSnippet>

describe("RunnableCodeFence", () => {
  beforeEach(() => {
    mockRunLocalSandboxCodeSnippet.mockReset()
    useChatStore.getState().resetSession()
    useChatStore.setState({
      sessionId: "session-runnable-1",
      messages: [
        {
          id: "assistant-runnable-1",
          role: "assistant",
          content: "",
          blocks: [],
          createdAt: Date.now(),
        },
      ],
    })
  })

  it("runs the edited code instead of the original fence source", async () => {
    mockRunLocalSandboxCodeSnippet.mockResolvedValue({
      success: true,
      status: "completed",
      language: "python",
      image: "python:slim",
      sandbox_id: "sandbox-1",
      runtime_mode: "sandbox",
      stdout: ["hello from edited code"],
      stderr: [],
      result: [],
      exit_code: 0,
      error: null,
      error_code: null,
      readiness: null,
    })

    render(
      <RunnableCodeFence
        source="print('original')"
        language="python"
        messageId="assistant-runnable-1"
        fenceId="fence-1"
      />
    )

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "print('edited')" },
    })
    fireEvent.click(screen.getByRole("button", { name: "codeBlock.run" }))

    await waitFor(() => {
      expect(mockRunLocalSandboxCodeSnippet).toHaveBeenCalledWith({
        sessionId: "session-runnable-1",
        language: "python",
        code: "print('edited')",
        executionTimeoutSecs: 30,
      })
    })

    expect(screen.getByText("Result")).toBeInTheDocument()
    expect(screen.getByText("hello from edited code")).toBeInTheDocument()
  })

  it("runs the edited code with Ctrl+Enter from the editor", async () => {
    mockRunLocalSandboxCodeSnippet.mockResolvedValue({
      success: true,
      status: "completed",
      language: "python",
      image: "python:slim",
      sandbox_id: "sandbox-2",
      runtime_mode: "sandbox",
      stdout: ["shortcut run"],
      stderr: [],
      result: [],
      exit_code: 0,
      error: null,
      error_code: null,
      readiness: null,
    })

    render(
      <RunnableCodeFence
        source="print('original')"
        language="python"
        messageId="assistant-runnable-1"
        fenceId="fence-1"
      />
    )

    const editor = screen.getByLabelText("runnable-code-editor")
    fireEvent.change(editor, {
      target: { value: "print('shortcut')" },
    })
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
    })

    await waitFor(() => {
      expect(mockRunLocalSandboxCodeSnippet).toHaveBeenCalledWith({
        sessionId: "session-runnable-1",
        language: "python",
        code: "print('shortcut')",
        executionTimeoutSecs: 30,
      })
    })
  })

  it("tracks run history, shows diff, and can rerun a selected previous run", async () => {
    mockRunLocalSandboxCodeSnippet
      .mockResolvedValueOnce({
        success: true,
        status: "completed",
        language: "python",
        image: "python:slim",
        sandbox_id: "sandbox-3",
        runtime_mode: "sandbox",
        stdout: ["first output"],
        stderr: [],
        result: [],
        exit_code: 0,
        error: null,
        error_code: null,
        readiness: null,
      })
      .mockResolvedValueOnce({
        success: true,
        status: "completed",
        language: "python",
        image: "python:slim",
        sandbox_id: "sandbox-4",
        runtime_mode: "sandbox",
        stdout: ["second output"],
        stderr: [],
        result: [],
        exit_code: 0,
        error: null,
        error_code: null,
        readiness: null,
      })
      .mockResolvedValueOnce({
        success: true,
        status: "completed",
        language: "python",
        image: "python:slim",
        sandbox_id: "sandbox-5",
        runtime_mode: "sandbox",
        stdout: ["rerun first output"],
        stderr: [],
        result: [],
        exit_code: 0,
        error: null,
        error_code: null,
        readiness: null,
      })

    render(
      <RunnableCodeFence
        source="print('base')"
        language="python"
        messageId="assistant-runnable-1"
        fenceId="fence-1"
      />
    )

    const editor = screen.getByLabelText("runnable-code-editor")
    fireEvent.change(editor, {
      target: { value: "print('first')" },
    })
    fireEvent.click(screen.getByRole("button", { name: "codeBlock.run" }))

    await waitFor(() => {
      expect(mockRunLocalSandboxCodeSnippet).toHaveBeenNthCalledWith(1, {
        sessionId: "session-runnable-1",
        language: "python",
        code: "print('first')",
        executionTimeoutSecs: 30,
      })
    })

    fireEvent.change(editor, {
      target: { value: "print('second')" },
    })
    fireEvent.click(screen.getByRole("button", { name: "codeBlock.run" }))

    await waitFor(() => {
      expect(mockRunLocalSandboxCodeSnippet).toHaveBeenNthCalledWith(2, {
        sessionId: "session-runnable-1",
        language: "python",
        code: "print('second')",
        executionTimeoutSecs: 30,
      })
    })

    expect(screen.getByRole("button", { name: "Run 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run 2" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "diff" }))
    await waitFor(() => {
      expect(screen.getByTestId("runnable-diff-pane")).toHaveTextContent("print('first')")
      expect(screen.getByTestId("runnable-diff-pane")).toHaveTextContent("print('second')")
    })

    fireEvent.click(screen.getByRole("button", { name: "Run 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }))

    await waitFor(() => {
      expect(mockRunLocalSandboxCodeSnippet).toHaveBeenNthCalledWith(3, {
        sessionId: "session-runnable-1",
        language: "python",
        code: "print('first')",
        executionTimeoutSecs: 30,
      })
    })
  })
})
