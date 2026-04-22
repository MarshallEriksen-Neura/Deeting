"use client"

import { memo } from "react"

import AudioResultPanel, {
  type AudioResultPayload,
} from "@/components/audio/audio-result-panel"
import type { NativeViewProps } from "./registry"

function toPayload(data: unknown): AudioResultPayload | null {
  if (!data || typeof data !== "object") {
    return null
  }
  return data as AudioResultPayload
}

const AudioResultView = memo<NativeViewProps>(function AudioResultView({ data }) {
  const payload = toPayload(data)
  if (!payload) {
    return null
  }

  return <AudioResultPanel payload={payload} />
})

export default AudioResultView
