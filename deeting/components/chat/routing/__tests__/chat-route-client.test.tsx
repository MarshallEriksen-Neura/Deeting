/** @jest-environment jsdom */

import React from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { ChatRouteClientMemo } from "@/components/chat/routing/chat-route-client"

const mockReplace = jest.fn()
const mockUseParams = jest.fn()
const mockUseSearchParams = jest.fn()
const mockFetchConversationSessions = jest.fn()
const mockRouter = { replace: mockReplace }

jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => mockRouter,
}))

jest.mock("@/components/chat/core", () => ({
  ChatContainer: ({ agentId }: { agentId: string }) => (
    <div data-testid="chat-container" data-agent-id={agentId} />
  ),
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => process.env.NEXT_PUBLIC_IS_TAURI === "true",
}))

jest.mock("@/lib/api/conversations", () => ({
  fetchConversationSessions: (...args: unknown[]) => mockFetchConversationSessions(...args),
}))

describe("ChatRouteClient", () => {
  beforeEach(() => {
    jest.useRealTimers()
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockReplace.mockReset()
    mockUseParams.mockReset()
    mockUseSearchParams.mockReset()
    mockFetchConversationSessions.mockReset()
    mockUseParams.mockReturnValue({ agentId: "agent-1" })
    mockUseSearchParams.mockReturnValue(new URLSearchParams("agentId=agent-2"))
    mockFetchConversationSessions.mockResolvedValue({
      items: [],
      next_page: null,
      previous_page: null,
    })
  })

  it("keeps current web behavior and does not restore desktop history", () => {
    render(<ChatRouteClientMemo />)

    expect(screen.getByTestId("chat-container").getAttribute("data-agent-id")).toBe("")
    expect(mockFetchConversationSessions).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("restores the latest desktop conversation when entering /chat without a session", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockUseParams.mockReturnValue({})
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""))
    mockFetchConversationSessions.mockResolvedValue({
      items: [
        {
          session_id: "session-local-1",
          title: "Recent chat",
          summary_text: null,
          message_count: 4,
          first_message_at: null,
          last_active_at: "2026-03-28T00:00:00Z",
        },
      ],
      next_page: null,
      previous_page: null,
    })

    render(<ChatRouteClientMemo />)

    await waitFor(() => {
      expect(mockFetchConversationSessions).toHaveBeenCalledWith({ size: 1, status: "active" })
    })
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/chat?session=session-local-1")
    })
  })

  it("falls through from a stale legacy agent route to session restore after normalization times out", async () => {
    jest.useFakeTimers()
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockUseParams.mockReturnValue({ agentId: "legacy-agent" })
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""))
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})

    render(<ChatRouteClientMemo />)

    expect(mockFetchConversationSessions).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith("/chat")

    await act(async () => {
      jest.advanceTimersByTime(1600)
    })

    await waitFor(() => {
      expect(mockFetchConversationSessions).toHaveBeenCalledWith({ size: 1, status: "active" })
    })
    await waitFor(() => {
      expect(screen.getByTestId("chat-container")).toBeInTheDocument()
    })
    expect(warnSpy).toHaveBeenCalledWith(
      "desktop legacy chat route normalization timed out; continuing with in-place session restore",
      {
        pathAgentId: "legacy-agent",
        queryAgentId: null,
      }
    )

    warnSpy.mockRestore()
  })

  it("does not redirect when desktop has no existing history", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockUseParams.mockReturnValue({})
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""))

    render(<ChatRouteClientMemo />)

    await waitFor(() => {
      expect(mockFetchConversationSessions).toHaveBeenCalledWith({ size: 1, status: "active" })
    })
    await waitFor(() => {
      expect(screen.getByTestId("chat-container")).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("does not override an explicit desktop session", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockUseParams.mockReturnValue({})
    mockUseSearchParams.mockReturnValue(new URLSearchParams("session=session-local-2"))

    render(<ChatRouteClientMemo />)

    expect(screen.getByTestId("chat-container")).toBeInTheDocument()
    expect(mockFetchConversationSessions).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("keeps the empty desktop chat visible when latest-session restore never resolves", async () => {
    jest.useFakeTimers()
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockUseParams.mockReturnValue({})
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""))
    mockFetchConversationSessions.mockReturnValue(new Promise(() => {}))
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})

    render(<ChatRouteClientMemo />)

    await waitFor(() => {
      expect(mockFetchConversationSessions).toHaveBeenCalledWith({ size: 1, status: "active" })
    })

    expect(screen.getByTestId("chat-container")).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(3500)
    })

    await waitFor(() => {
      expect(screen.getByTestId("chat-container")).toBeInTheDocument()
    })
    expect(mockReplace).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      "desktop latest chat session restore timed out; falling back to empty chat"
    )

    warnSpy.mockRestore()
  })
})
