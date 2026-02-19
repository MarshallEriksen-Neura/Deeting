import { useImageGenerationStore } from "../image-generation-store"

describe("useImageGenerationStore loading state", () => {
  const resetStore = () => {
    sessionStorage.clear()
    useImageGenerationStore.setState({
      selectedModelId: null,
      sessionId: null,
      ratio: "1:1",
      steps: 30,
      guidance: 7.5,
      isGenerating: false,
      pendingPrompt: null,
    })
  }

  beforeEach(() => {
    resetStore()
  })

  it("startGeneration should set pending prompt and generating flag", () => {
    useImageGenerationStore.getState().startGeneration("test prompt")

    const state = useImageGenerationStore.getState()
    expect(state.isGenerating).toBe(true)
    expect(state.pendingPrompt).toBe("test prompt")
  })

  it("finishGeneration should clear pending state", () => {
    useImageGenerationStore.getState().startGeneration("test prompt")
    useImageGenerationStore.getState().finishGeneration()

    const state = useImageGenerationStore.getState()
    expect(state.isGenerating).toBe(false)
    expect(state.pendingPrompt).toBeNull()
  })

  it("resetSession should clear session and pending generation state", () => {
    useImageGenerationStore.setState({
      sessionId: "session-123",
      isGenerating: true,
      pendingPrompt: "draw something",
    })

    useImageGenerationStore.getState().resetSession()

    const state = useImageGenerationStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.isGenerating).toBe(false)
    expect(state.pendingPrompt).toBeNull()
  })
})
