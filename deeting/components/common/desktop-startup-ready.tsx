"use client"

import { useEffect } from "react"

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
const DESKTOP_UI_READY_EVENT = "desktop-ui-ready"
const FONT_READY_TIMEOUT_MS = 1200

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function waitForDocumentFonts() {
  const fonts = (document as Document & {
    fonts?: {
      ready: Promise<unknown>
    }
  }).fonts

  if (!fonts?.ready) return

  await Promise.race([
    fonts.ready,
    new Promise((resolve) => {
      window.setTimeout(resolve, FONT_READY_TIMEOUT_MS)
    }),
  ])
}

export function DesktopStartupReady() {
  useEffect(() => {
    if (!isTauri || typeof window === "undefined") return

    let cancelled = false

    const emitReady = async () => {
      try {
        if (document.readyState === "loading") {
          await new Promise<void>((resolve) => {
            document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
          })
        }

        await waitForDocumentFonts()
        await waitForAnimationFrame()
        await waitForAnimationFrame()

        if (cancelled) return

        const { emit } = await import("@tauri-apps/api/event")
        await emit(DESKTOP_UI_READY_EVENT, {
          emittedAt: new Date().toISOString(),
        })
      } catch (error) {
        console.error("desktop startup ready emit failed:", error)
      }
    }

    emitReady()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
