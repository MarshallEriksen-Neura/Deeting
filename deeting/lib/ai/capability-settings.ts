export type Capability = "chat" | "image" | "audio" | "video"
export type AudioMode = "tts" | "stt"

export type ParamSetting<T> = {
  enabled: boolean
  value: T
}

export type ChatModelSettings = {
  temperature: ParamSetting<number>
  top_p: ParamSetting<number>
  presence_penalty: ParamSetting<number>
  frequency_penalty: ParamSetting<number>
  max_tokens: ParamSetting<number>
  seed: ParamSetting<number>
}

export type ImageModelSettings = {
  width: ParamSetting<number>
  height: ParamSetting<number>
  aspect_ratio: ParamSetting<string>
  steps: ParamSetting<number>
  cfg_scale: ParamSetting<number>
  seed: ParamSetting<number>
  num_outputs: ParamSetting<number>
  quality: ParamSetting<string>
  style: ParamSetting<string>
}

export type TTSModelSettings = {
  voice: ParamSetting<string>
  speed: ParamSetting<number>
  pitch: ParamSetting<number>
  volume: ParamSetting<number>
  stability: ParamSetting<number>
  similarity_boost: ParamSetting<number>
  style_exaggeration: ParamSetting<number>
  response_format: ParamSetting<string>
}

export type STTModelSettings = {
  language: ParamSetting<string>
  temperature: ParamSetting<number>
  response_format: ParamSetting<string>
  timestamp_granularities: ParamSetting<string[]>
}

export type AudioModelSettings = {
  mode: AudioMode
  tts: TTSModelSettings
  stt: STTModelSettings
}

export type VideoModelSettings = {
  width: ParamSetting<number>
  height: ParamSetting<number>
  duration_seconds: ParamSetting<number>
  fps: ParamSetting<number>
  motion_bucket_id: ParamSetting<number>
  noise_aug_strength: ParamSetting<number>
  seed: ParamSetting<number>
  aspect_ratio: ParamSetting<string>
  resolution: ParamSetting<string>
  negative_prompt: ParamSetting<string>
}

export type CapabilitySettings = {
  chat: ChatModelSettings
  image: ImageModelSettings
  audio: AudioModelSettings
  video: VideoModelSettings
}

export type ChatRequestParams = Partial<{
  temperature: number
  top_p: number
  presence_penalty: number
  frequency_penalty: number
  max_tokens: number
  seed: number
}>

export type ImageRequestParams = Partial<{
  width: number
  height: number
  aspect_ratio: string
  steps: number
  cfg_scale: number
  seed: number
  num_outputs: number
  quality: string
  style: string
}>

export type TTSRequestParams = Partial<{
  voice: string
  speed: number
  pitch: number
  volume: number
  stability: number
  similarity_boost: number
  style_exaggeration: number
  response_format: string
}>

export type STTRequestParams = Partial<{
  language: string
  temperature: number
  response_format: string
  timestamp_granularities: string[]
}>

export type AudioRequestParams =
  | { mode: "tts"; tts: TTSRequestParams }
  | { mode: "stt"; stt: STTRequestParams }

export type VideoRequestParams = Partial<{
  width: number
  height: number
  duration_seconds: number
  fps: number
  motion_bucket_id: number
  noise_aug_strength: number
  seed: number
  aspect_ratio: string
  resolution: string
  negative_prompt: string
}>

export type CapabilityRequestParams = {
  chat: ChatRequestParams
  image: ImageRequestParams
  audio: AudioRequestParams
  video: VideoRequestParams
}

export const DEFAULT_CAPABILITY_SETTINGS: CapabilitySettings = {
  chat: {
    temperature: { enabled: true, value: 1.0 },
    top_p: { enabled: true, value: 1.0 },
    presence_penalty: { enabled: true, value: 0.0 },
    frequency_penalty: { enabled: true, value: 0.0 },
    max_tokens: { enabled: false, value: 1024 },
    seed: { enabled: false, value: 0 },
  },
  image: {
    width: { enabled: false, value: 1024 },
    height: { enabled: false, value: 1024 },
    aspect_ratio: { enabled: false, value: "1:1" },
    steps: { enabled: false, value: 30 },
    cfg_scale: { enabled: false, value: 7.0 },
    seed: { enabled: false, value: 0 },
    num_outputs: { enabled: false, value: 1 },
    quality: { enabled: false, value: "standard" },
    style: { enabled: false, value: "natural" },
  },
  audio: {
    mode: "tts",
    tts: {
      voice: { enabled: false, value: "default" },
      speed: { enabled: false, value: 1.0 },
      pitch: { enabled: false, value: 0 },
      volume: { enabled: false, value: 1.0 },
      stability: { enabled: false, value: 0.5 },
      similarity_boost: { enabled: false, value: 0.5 },
      style_exaggeration: { enabled: false, value: 0.0 },
      response_format: { enabled: false, value: "mp3" },
    },
    stt: {
      language: { enabled: false, value: "auto" },
      temperature: { enabled: false, value: 0.0 },
      response_format: { enabled: false, value: "json" },
      timestamp_granularities: { enabled: false, value: [] },
    },
  },
  video: {
    width: { enabled: false, value: 1280 },
    height: { enabled: false, value: 720 },
    duration_seconds: { enabled: false, value: 4 },
    fps: { enabled: false, value: 24 },
    motion_bucket_id: { enabled: false, value: 127 },
    noise_aug_strength: { enabled: false, value: 0.1 },
    seed: { enabled: false, value: 0 },
    aspect_ratio: { enabled: false, value: "16:9" },
    resolution: { enabled: false, value: "720p" },
    negative_prompt: { enabled: false, value: "" },
  },
}

export function cloneDefaultCapabilitySettings(): CapabilitySettings {
  if (typeof structuredClone === "function") {
    return structuredClone(DEFAULT_CAPABILITY_SETTINGS)
  }
  return JSON.parse(JSON.stringify(DEFAULT_CAPABILITY_SETTINGS)) as CapabilitySettings
}

type EnabledValue<T> = T extends ParamSetting<infer V> ? V : never

function extractEnabledParams<T extends Record<string, ParamSetting<unknown>>>(
  settings: T
): Partial<Record<keyof T, EnabledValue<T[keyof T]>>> {
  const result: Partial<Record<keyof T, EnabledValue<T[keyof T]>>> = {}
  ;(Object.keys(settings) as Array<keyof T>).forEach((key) => {
    const item = settings[key]
    if (item.enabled) {
      result[key] = item.value as EnabledValue<T[keyof T]>
    }
  })
  return result
}

export function getChatRequestParams(settings: ChatModelSettings): ChatRequestParams {
  return extractEnabledParams(settings) as ChatRequestParams
}

export function getImageRequestParams(settings: ImageModelSettings): ImageRequestParams {
  return extractEnabledParams(settings) as ImageRequestParams
}

export function getAudioRequestParams(settings: AudioModelSettings): AudioRequestParams {
  if (settings.mode === "tts") {
    return {
      mode: "tts",
      tts: extractEnabledParams(settings.tts) as TTSRequestParams,
    }
  }
  return {
    mode: "stt",
    stt: extractEnabledParams(settings.stt) as STTRequestParams,
  }
}

export function getVideoRequestParams(settings: VideoModelSettings): VideoRequestParams {
  return extractEnabledParams(settings) as VideoRequestParams
}

export function getCapabilityRequestParams(
  capability: Capability,
  settings: CapabilitySettings
): CapabilityRequestParams[Capability] {
  switch (capability) {
    case "chat":
      return getChatRequestParams(settings.chat)
    case "image":
      return getImageRequestParams(settings.image)
    case "audio":
      return getAudioRequestParams(settings.audio)
    case "video":
      return getVideoRequestParams(settings.video)
    default:
      {
        const _exhaustive: never = capability
        return getChatRequestParams(settings.chat)
      }
  }
}
