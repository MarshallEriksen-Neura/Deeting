"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  previewLocalLlmWikiCandidate,
  supportsLocalLlmWiki,
  type LocalLlmWikiCandidatePreview,
  type PreviewLocalLlmWikiCandidatePayload,
} from "@/lib/api/llm-wiki"

interface UseLlmWikiCandidatePreviewOptions {
  open: boolean
  canPreview: boolean
  payload: PreviewLocalLlmWikiCandidatePayload
  desktopOnlyMessage: string
  unavailableMessage: string
  previewFailedMessage: string
}

export function useLlmWikiCandidatePreview({
  open,
  canPreview,
  payload,
  desktopOnlyMessage,
  unavailableMessage,
  previewFailedMessage,
}: UseLlmWikiCandidatePreviewOptions) {
  const [preview, setPreview] = React.useState<LocalLlmWikiCandidatePreview | null>(null)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || preview || isPreviewing) return
    let cancelled = false

    async function loadPreview() {
      if (!supportsLocalLlmWiki()) {
        setErrorMessage(desktopOnlyMessage)
        toast.error(desktopOnlyMessage)
        return
      }
      if (!canPreview) {
        setErrorMessage(unavailableMessage)
        return
      }

      setIsPreviewing(true)
      setErrorMessage(null)

      try {
        const nextPreview = await previewLocalLlmWikiCandidate(payload)
        if (!cancelled) setPreview(nextPreview)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : previewFailedMessage
        if (!cancelled) {
          setErrorMessage(message)
          toast.error(message)
        }
      } finally {
        if (!cancelled) setIsPreviewing(false)
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
    }
  }, [
    canPreview,
    desktopOnlyMessage,
    open,
    payload,
    preview,
    previewFailedMessage,
    unavailableMessage,
  ])

  const resetPreview = React.useCallback(() => {
    setPreview(null)
    setErrorMessage(null)
  }, [])

  return {
    preview,
    setPreview,
    isPreviewing,
    errorMessage,
    setErrorMessage,
    resetPreview,
  }
}
