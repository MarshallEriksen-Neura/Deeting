"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import {
  type Capability,
  type CapabilitySettings,
  type ChatModelSettings,
  type ImageModelSettings,
  type VideoModelSettings,
  type TTSModelSettings,
  type STTModelSettings,
  cloneDefaultCapabilitySettings,
} from "@/lib/ai/capability-settings"

interface CapabilitySettingsState {
  settings: CapabilitySettings
}

interface CapabilitySettingsActions {
  setChatSetting: <K extends keyof ChatModelSettings>(
    key: K,
    patch: Partial<ChatModelSettings[K]>
  ) => void
  setImageGenerationSetting: <K extends keyof ImageModelSettings>(
    key: K,
    patch: Partial<ImageModelSettings[K]>
  ) => void
  setVideoGenerationSetting: <K extends keyof VideoModelSettings>(
    key: K,
    patch: Partial<VideoModelSettings[K]>
  ) => void
  setTextToSpeechSetting: <K extends keyof TTSModelSettings>(
    key: K,
    patch: Partial<TTSModelSettings[K]>
  ) => void
  setSpeechToTextSetting: <K extends keyof STTModelSettings>(
    key: K,
    patch: Partial<STTModelSettings[K]>
  ) => void
  resetCapability: (capability: Capability) => void
  resetAll: () => void
}

type CapabilitySettingsStore = CapabilitySettingsState & CapabilitySettingsActions

const DEFAULT_SETTINGS_STATE: CapabilitySettingsState = {
  settings: cloneDefaultCapabilitySettings(),
}

export const useCapabilitySettingsStore = create<CapabilitySettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS_STATE,
      setChatSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            chat: {
              ...state.settings.chat,
              [key]: {
                ...state.settings.chat[key],
                ...patch,
              },
            },
          },
        })),
      setImageGenerationSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            image_generation: {
              ...state.settings.image_generation,
              [key]: {
                ...state.settings.image_generation[key],
                ...patch,
              },
            },
          },
        })),
      setVideoGenerationSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            video_generation: {
              ...state.settings.video_generation,
              [key]: {
                ...state.settings.video_generation[key],
                ...patch,
              },
            },
          },
        })),
      setTextToSpeechSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            text_to_speech: {
              ...state.settings.text_to_speech,
              [key]: {
                ...state.settings.text_to_speech[key],
                ...patch,
              },
            },
          },
        })),
      setSpeechToTextSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            speech_to_text: {
              ...state.settings.speech_to_text,
              [key]: {
                ...state.settings.speech_to_text[key],
                ...patch,
              },
            },
          },
        })),
      resetCapability: (capability) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [capability]: cloneDefaultCapabilitySettings()[capability],
          },
        })),
      resetAll: () =>
        set(() => ({
          settings: cloneDefaultCapabilitySettings(),
        })),
    }),
    {
      name: "deeting-capability-settings-store",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (state) => ({
        settings: state.settings,
      }),
      migrate: (state, version) => {
        if (!state || version < 2) {
          return DEFAULT_SETTINGS_STATE
        }
        return state
      },
    }
  )
)
