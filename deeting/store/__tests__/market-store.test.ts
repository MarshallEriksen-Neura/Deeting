jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

describe("useMarketStore local assistant decommission", () => {
  const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI

  afterEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("does not load local assistants in desktop mode anymore", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    const { invoke } = await import("@tauri-apps/api/core")
    const { useMarketStore } = await import("../market-store")

    await useMarketStore.getState().loadLocalAssistants()

    expect(useMarketStore.getState().loaded).toBe(true)
    expect(useMarketStore.getState().installedAgents).toEqual([])
    expect(useMarketStore.getState().localAssistants).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it("rejects legacy local assistant creation", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    const { invoke } = await import("@tauri-apps/api/core")
    const { useMarketStore } = await import("../market-store")

    await expect(
      useMarketStore.getState().createLocalAssistant({
        name: "Legacy local assistant",
        system_prompt: "prompt",
      })
    ).rejects.toThrow("local assistant authoring has moved to the cloud")

    expect(invoke).not.toHaveBeenCalled()
  })
})
