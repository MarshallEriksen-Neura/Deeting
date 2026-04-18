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
  })
})
