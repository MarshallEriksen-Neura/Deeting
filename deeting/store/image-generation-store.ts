"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

interface ImageGenerationState {
  selectedModelId: string | null
  sessionId: string | null
  ratio: "1:1" | "16:9" | "9:16"
  steps: number
  guidance: number
  isGenerating: boolean
  pendingPrompt: string | null
}

interface ImageGenerationActions {
  setSelectedModelId: (modelId: string | null) => void
  setSessionId: (sessionId: string | null) => void
  setRatio: (ratio: "1:1" | "16:9" | "9:16") => void
  setSteps: (steps: number) => void
  setGuidance: (guidance: number) => void
  startGeneration: (prompt: string) => void
  finishGeneration: () => void
  resetSession: () => void
}

type ImageGenerationStore = ImageGenerationState & ImageGenerationActions

const DEFAULT_STATE: ImageGenerationState = {
  selectedModelId: null,
  sessionId: null,
  ratio: "1:1",
  steps: 30,
  guidance: 7.5,
  isGenerating: false,
  pendingPrompt: null,
}

export const useImageGenerationStore = create<ImageGenerationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),
      setSessionId: (sessionId) => set({ sessionId }),
      setRatio: (ratio) => set({ ratio }),
      setSteps: (steps) => set({ steps }),
      setGuidance: (guidance) => set({ guidance }),
      startGeneration: (prompt) =>
        set({
          isGenerating: true,
          pendingPrompt: prompt,
        }),
      finishGeneration: () =>
        set({
          isGenerating: false,
          pendingPrompt: null,
        }),
      resetSession: () =>
        set({
          sessionId: null,
          isGenerating: false,
          pendingPrompt: null,
        }),
    }),
    {
      name: "deeting-image-generation-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 3,
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        sessionId: state.sessionId,
        ratio: state.ratio,
        steps: state.steps,
        guidance: state.guidance,
      }),
      migrate: (state, version) => {
        if (!state || version < 1) {
          return DEFAULT_STATE
        }
        if (version < 3) {
          return {
            ...DEFAULT_STATE,
            ...(state as Partial<ImageGenerationState>),
          }
        }
        return {
          ...DEFAULT_STATE,
          ...(state as Partial<ImageGenerationState>),
        }
      },
    }
  )
)
