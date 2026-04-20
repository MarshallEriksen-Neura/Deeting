import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { renderToString } from "react-dom/server.node"

import type { LocalModelPoolStatus } from "@/lib/api/model-pools"

import { ModelPoolsPageClient } from "./page-client"

const mockUseSWR = jest.fn()
const runtimeState = { isTauri: true }

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => runtimeState.isTauri,
}))

jest.mock("@/components/ui/container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

jest.mock("@/components/ui/page-header/page-header", () => ({
  PageHeader: ({
    title,
    description,
  }: {
    title: string
    description?: string
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  GlassCardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  GlassCardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

const pools: LocalModelPoolStatus[] = [
  {
    pool_key: "writing",
    display_name: "Writing Pool",
    provider_count: 2,
    active_provider_count: 1,
    cooling_down_count: 1,
    active_session_count: 3,
    health_score: 88,
    success_rate: 0.94,
    avg_latency_ms: 122,
    bindings: [
      {
        session_id: "session-1",
        title: "Draft blog post",
        pinned_provider_model_id: "openai/gpt-4.1",
        last_active_at: "2026-04-03T08:30:00Z",
        updated_at: "2026-04-03T08:20:00Z",
      },
    ],
    members: [
      {
        provider_model_id: "provider-model-1",
        instance_id: "instance-1",
        instance_name: "OpenAI Primary",
        provider: "openai",
        model_id: "gpt-4.1",
        unified_model_id: "gpt-4.1",
        display_name: "GPT-4.1",
        status: "ready",
        success_rate: 0.97,
        avg_latency_ms: 111,
        total_trials: 20,
        successes: 19,
        failures: 1,
        cooldown_until: null,
        is_pinned: true,
        pinned_session_count: 3,
      },
    ],
  },
  {
    pool_key: "research",
    display_name: "Research Pool",
    provider_count: 1,
    active_provider_count: 1,
    cooling_down_count: 0,
    active_session_count: 1,
    health_score: 72,
    success_rate: 0.9,
    avg_latency_ms: 240,
    bindings: [],
    members: [
      {
        provider_model_id: "provider-model-2",
        instance_id: "instance-2",
        instance_name: "Anthropic Backup",
        provider: "anthropic",
        model_id: "claude-sonnet",
        unified_model_id: "claude-sonnet",
        display_name: "Claude Sonnet",
        status: "active",
        success_rate: 0.88,
        avg_latency_ms: 240,
        total_trials: 8,
        successes: 7,
        failures: 1,
        cooldown_until: null,
        is_pinned: false,
        pinned_session_count: 0,
      },
    ],
  },
]

describe("ModelPoolsPageClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runtimeState.isTauri = true
  })

  it("renders a hydration-safe loading shell during server render", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    })

    const html = renderToString(<ModelPoolsPageClient />)

    expect(html).toContain("data-testid=\"skeleton\"")
    expect(html).not.toContain("desktopOnlyTitle")
  })

  it("shows desktop-only guidance outside Tauri runtime", async () => {
    runtimeState.isTauri = false
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    })

    render(<ModelPoolsPageClient />)

    await waitFor(() => {
      expect(screen.getByText("desktopOnlyTitle")).toBeInTheDocument()
      expect(screen.getByText("desktopOnlyDescription")).toBeInTheDocument()
    })
  })

  it("renders the error state when loading fails", async () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    })

    render(<ModelPoolsPageClient />)

    await waitFor(() => {
      expect(screen.getByText("errorTitle")).toBeInTheDocument()
      expect(screen.getByText("Error: boom")).toBeInTheDocument()
    })
  })

  it("switches the visible pool details when another pool is selected", async () => {
    mockUseSWR.mockReturnValue({
      data: pools,
      isLoading: false,
      error: undefined,
    })

    render(<ModelPoolsPageClient />)

    await waitFor(() => {
      expect(screen.getAllByText("Writing Pool").length).toBeGreaterThan(0)
      expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: /Research Pool/ }))

    await waitFor(() => {
      expect(screen.getAllByText("Research Pool").length).toBeGreaterThan(0)
      expect(screen.getByText("Claude Sonnet")).toBeInTheDocument()
      expect(screen.getByText("empty.bindings")).toBeInTheDocument()
    })
  })
})
