"use client"

import * as React from "react"

import { fetchUserSecretary } from "@/lib/api/secretary"
import { fetchUserEmbeddingConfig } from "@/lib/api/user-embedding-config"
import { hasSecretaryModelSelection } from "@/lib/model-selection"
import { emitModelConfigRequired, type MissingDesktopModelConfig } from "@/lib/model-config-required"

function isDesktopRuntime() {
  return process.env.NEXT_PUBLIC_IS_TAURI === "true"
}

export function ChatModelConfigGuard() {
  const checkedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isDesktopRuntime()) return
    if (checkedRef.current) return
    checkedRef.current = true

    let cancelled = false
    ;(async () => {
      try {
        const [secretary, embedding] = await Promise.all([
          fetchUserSecretary(),
          fetchUserEmbeddingConfig(),
        ])
        if (cancelled) return

        const missing: MissingDesktopModelConfig[] = []
        if (!hasSecretaryModelSelection(secretary)) {
          missing.push("secretary")
        }
        if (!embedding.provider_model_id?.trim()) {
          missing.push("embedding")
        }
        if (missing.length > 0) {
          emitModelConfigRequired({ missing })
        }
      } catch (error) {
        console.warn("[chat-model-config-guard] model config check failed", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
