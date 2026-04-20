"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type CameraDirection =
  | "up-left"
  | "up"
  | "up-right"
  | "left"
  | "center"
  | "right"
  | "down-left"
  | "down"
  | "down-right"
  | "zoom-in"
  | "zoom-out"

interface VideoGenerationState {
  selectedModelId: string | null
  sessionId: string | null
  ratio: "16:9" | "9:16" | "1:1"
  duration: number
  fps: number
  motionBucketId: number
  prompt: string
  imageUrl: string | null
  audioUrl: string | null
  videoUrl: string | null
  endImageUrl: string | null
  cameraDirection: CameraDirection
}

interface VideoGenerationActions {
  setSelectedModelId: (modelId: string | null) => void
  setSessionId: (sessionId: string | null) => void
  setRatio: (ratio: "16:9" | "9:16" | "1:1") => void
  setDuration: (duration: number) => void
  setFps: (fps: number) => void
  setMotionBucketId: (id: number) => void
  setPrompt: (prompt: string) => void
  setImageUrl: (url: string | null) => void
  setAudioUrl: (url: string | null) => void
  setVideoUrl: (url: string | null) => void
  setEndImageUrl: (url: string | null) => void
  setCameraDirection: (direction: CameraDirection) => void
  resetSession: () => void
  resetGeneration: () => void
}

type VideoGenerationStore = VideoGenerationState & VideoGenerationActions

const DEFAULT_STATE: VideoGenerationState = {
  selectedModelId: null,
  sessionId: null,
  ratio: "16:9",
  duration: 4,
  fps: 24,
  motionBucketId: 127,
  prompt: "",
  imageUrl: null,
  audioUrl: null,
  videoUrl: null,
  endImageUrl: null,
  cameraDirection: "center",
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
      setPrompt: (prompt) => set({ prompt }),
      setImageUrl: (url) => set({ imageUrl: url }),
      setAudioUrl: (url) => set({ audioUrl: url }),
      setVideoUrl: (url) => set({ videoUrl: url }),
      setEndImageUrl: (url) => set({ endImageUrl: url }),
      setCameraDirection: (direction) => set({ cameraDirection: direction }),
      resetSession: () => set({ sessionId: null }),
      resetGeneration: () =>
        set({
          prompt: "",
          imageUrl: null,
          audioUrl: null,
          videoUrl: null,
          endImageUrl: null,
          cameraDirection: "center",
          motionBucketId: 127,
        }),
    }),
    {
      name: "deeting-video-generation-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 3,
      partialize: (state) => ({
        selectedModelId: state.selectedModelId,
        sessionId: state.sessionId,
        ratio: state.ratio,
        duration: state.duration,
        fps: state.fps,
        motionBucketId: state.motionBucketId,
        prompt: state.prompt,
        imageUrl: state.imageUrl,
        audioUrl: state.audioUrl,
        videoUrl: state.videoUrl,
        endImageUrl: state.endImageUrl,
        cameraDirection: state.cameraDirection,
      }),
    }
  )
)
