"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

interface ImageGenerationState {
  selectedModelId: string | null
  sessionId: string | null
}

interface ImageGenerationActions {
  setSelectedModelId: (modelId: string | null) => void
  setSessionId: (sessionId: string | null) => void
  resetSession: () => void
}

type ImageGenerationStore = ImageGenerationState & ImageGenerationActions

const DEFAULT_STATE: ImageGenerationState = {
  selectedModelId: null,
  sessionId: null,
}

export const useImageGenerationStore = create<ImageGenerationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),
      setSessionId: (sessionId) => set({ sessionId }),
      resetSession: () => set({ sessionId: null }),
    }),
    {
      name: "deeting-image-generation-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        sessionId: state.sessionId,
      }),
      migrate: (state, version) => {
        if (!state || version < 1) {
          return DEFAULT_STATE
        }
        return state as ImageGenerationState
      },
    }
  )
)
