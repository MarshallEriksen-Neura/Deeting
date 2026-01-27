"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

interface VideoGenerationState {
  selectedModelId: string | null
  sessionId: string | null
  ratio: "16:9" | "9:16" | "1:1"
  duration: number
  fps: number
  motionBucketId: number
}

interface VideoGenerationActions {
  setSelectedModelId: (modelId: string | null) => void
  setSessionId: (sessionId: string | null) => void
  setRatio: (ratio: "16:9" | "9:16" | "1:1") => void
  setDuration: (duration: number) => void
  setFps: (fps: number) => void
  setMotionBucketId: (id: number) => void
  resetSession: () => void
}

type VideoGenerationStore = VideoGenerationState & VideoGenerationActions

const DEFAULT_STATE: VideoGenerationState = {
  selectedModelId: null,
  sessionId: null,
  ratio: "16:9",
  duration: 4,
  fps: 24,
  motionBucketId: 127,
}

export const useVideoGenerationStore = create<VideoGenerationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),
      setSessionId: (sessionId) => set({ sessionId }),
      setRatio: (ratio) => set({ ratio }),
      setDuration: (duration) => set({ duration }),
      setFps: (fps) => set({ fps }),
      setMotionBucketId: (id) => set({ motionBucketId: id }),
      resetSession: () => set({ sessionId: null }),
    }),
    {
      name: "deeting-video-generation-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        sessionId: state.sessionId,
        ratio: state.ratio,
        duration: state.duration,
        fps: state.fps,
        motionBucketId: state.motionBucketId,
      }),
    }
  )
)
