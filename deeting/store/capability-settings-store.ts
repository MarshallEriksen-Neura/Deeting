"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import {
  type AudioMode,
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
  setImageSetting: <K extends keyof ImageModelSettings>(
    key: K,
    patch: Partial<ImageModelSettings[K]>
  ) => void
  setVideoSetting: <K extends keyof VideoModelSettings>(
    key: K,
    patch: Partial<VideoModelSettings[K]>
  ) => void
  setAudioMode: (mode: AudioMode) => void
  setAudioSetting: {
    <K extends keyof TTSModelSettings>(
      section: "tts",
      key: K,
      patch: Partial<TTSModelSettings[K]>
    ): void
    <K extends keyof STTModelSettings>(
      section: "stt",
      key: K,
      patch: Partial<STTModelSettings[K]>
    ): void
  }
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
      setImageSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            image: {
              ...state.settings.image,
              [key]: {
                ...state.settings.image[key],
                ...patch,
              },
            },
          },
        })),
      setVideoSetting: (key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            video: {
              ...state.settings.video,
              [key]: {
                ...state.settings.video[key],
                ...patch,
              },
            },
          },
        })),
      setAudioMode: (mode) =>
        set((state) => ({
          settings: {
            ...state.settings,
            audio: {
              ...state.settings.audio,
              mode,
            },
          },
        })),
      setAudioSetting: (section, key, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            audio: {
              ...state.settings.audio,
              [section]: {
                ...state.settings.audio[section],
                [key]: {
                  ...state.settings.audio[section][key],
                  ...patch,
                },
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
      version: 1,
      partialize: (state) => ({
        settings: state.settings,
      }),
      migrate: (state, version) => {
        if (!state || version < 1) {
          return DEFAULT_SETTINGS_STATE
        }
        return state
      },
    }
  )
)
