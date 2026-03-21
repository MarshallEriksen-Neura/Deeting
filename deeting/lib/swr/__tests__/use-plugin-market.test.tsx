import * as React from "react"
import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

import { usePluginMarket } from "@/lib/swr/use-plugin-market"
import { fetchPluginMarket } from "@/lib/api/plugin-market"

jest.mock("@/lib/api/plugin-market", () => ({
  fetchPluginMarket: jest.fn(),
}))

const mockFetchPluginMarket = fetchPluginMarket as jest.MockedFunction<typeof fetchPluginMarket>

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
        }}
      >
        {children}
      </SWRConfig>
    )
  }
}

describe("usePluginMarket", () => {
  afterEach(() => {
    mockFetchPluginMarket.mockReset()
  })

  it("does not fetch when disabled", async () => {
    const { result } = renderHook(
      () => usePluginMarket(undefined, { enabled: false }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.plugins).toEqual([])
    expect(mockFetchPluginMarket).not.toHaveBeenCalled()
  })

  it("fetches market data when enabled", async () => {
    mockFetchPluginMarket.mockResolvedValue([
      {
        id: "skill.alpha",
        name: "Alpha Skill",
        description: "desc",
        version: "1.0.0",
        source_repo: "https://github.com/example/alpha",
        source_revision: "main",
        source_kind: "community",
        status: "active",
        installed: false,
        compatibility: {},
      },
    ])

    const { result } = renderHook(
      () => usePluginMarket({ q: "alpha" }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(1)
    })

    expect(mockFetchPluginMarket).toHaveBeenCalledWith({ q: "alpha" })
  })
})
