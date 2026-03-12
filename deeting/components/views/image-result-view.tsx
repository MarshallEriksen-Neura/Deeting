"use client"

import { memo } from "react"

import ImageResultPanel, { type ImageResultPanelPayload } from "@/components/image/image-result-panel"
import type { NativeViewProps } from "./registry"

function toPayload(data: unknown): ImageResultPanelPayload | null {
  if (!data || typeof data !== "object") {
    return null
  }
  return data as ImageResultPanelPayload
}

const ImageResultView = memo<NativeViewProps>(function ImageResultView({ data }) {
  const payload = toPayload(data)
  if (!payload) {
    return null
  }

  return <ImageResultPanel payload={payload} />
})

export default ImageResultView
