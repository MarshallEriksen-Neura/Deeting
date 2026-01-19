"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

interface ImageGenerationState {
  selectedModelId: string | null
}

interface ImageGenerationActions {
  setSelectedModelId: (modelId: string | null) => void
}

type ImageGenerationStore = ImageGenerationState & ImageGenerationActions

const DEFAULT_STATE: ImageGenerationState = {
  selectedModelId: null,
}

export const useImageGenerationStore = create<ImageGenerationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),
    }),
    {
      name: "deeting-image-generation-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
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
