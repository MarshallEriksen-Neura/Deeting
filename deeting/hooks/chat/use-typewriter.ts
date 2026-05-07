import { useEffect, useRef, useState } from "react"

const DEFAULT_BASE_INTERVAL = 16
const MEDIUM_TEXT_LENGTH = 300
const LONG_TEXT_LENGTH = 800
const MEDIUM_INTERVAL = 12
const LONG_INTERVAL = 8
const MIN_INTERVAL = 6
const MAX_INTERVAL = 28
const MAX_DURATION_MS = 4500
const PUNCTUATION_DELAY = 70
const SHORT_PAUSE_DELAY = 35
const NEWLINE_DELAY = 100

function resolveBaseInterval(length: number) {
  if (length >= LONG_TEXT_LENGTH) return LONG_INTERVAL
  if (length >= MEDIUM_TEXT_LENGTH) return MEDIUM_INTERVAL
  return DEFAULT_BASE_INTERVAL
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function extraDelayForChar(char: string) {
  if (char === "\n") return NEWLINE_DELAY
  if (/[。！？.!?]/.test(char)) return PUNCTUATION_DELAY
  if (/[，,、;；]/.test(char)) return SHORT_PAUSE_DELAY
  return 0
}

function resolveInterval(length: number) {
  if (length <= 0) return DEFAULT_BASE_INTERVAL
  const base = resolveBaseInterval(length)
  const durationCap = Math.ceil(MAX_DURATION_MS / Math.max(length, 1))
  return clamp(Math.min(base, durationCap), MIN_INTERVAL, MAX_INTERVAL)
}

export function useTypewriter(targetText: string, enabled: boolean) {
  const [displayed, setDisplayed] = useState(enabled ? "" : targetText)
  const indexRef = useRef(0)
  const displayedRef = useRef(displayed)
  const targetRef = useRef(targetText)
  const enabledRef = useRef(enabled)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runIdRef = useRef(0)

  useEffect(() => {
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    targetRef.current = targetText
    enabledRef.current = enabled

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const setDisplayedText = (nextDisplayed: string) => {
      if (displayedRef.current === nextDisplayed) return
      displayedRef.current = nextDisplayed
      setDisplayed(nextDisplayed)
    }

    const tick = () => {
      if (runId !== runIdRef.current) {
        return
      }
      if (!enabledRef.current) {
        clearTimer()
        return
      }
      const target = targetRef.current
      const currentIndex = indexRef.current
      if (currentIndex >= target.length) {
        clearTimer()
        return
      }
      const nextChar = target[currentIndex]
      const interval = resolveInterval(target.length)
      const delay = interval + extraDelayForChar(nextChar)
      timerRef.current = setTimeout(() => {
        if (runId !== runIdRef.current) {
          return
        }
        indexRef.current = currentIndex + 1
        setDisplayedText(target.slice(0, indexRef.current))
        tick()
      }, delay)
    }

    clearTimer()

    if (!enabled) {
      indexRef.current = targetText.length
      setDisplayedText(targetText)
      return
    }

    if (!targetText) {
      indexRef.current = 0
      setDisplayedText("")
      return
    }

    const displayedPrefix = displayedRef.current
    if (
      targetText.length < indexRef.current ||
      (displayedPrefix && !targetText.startsWith(displayedPrefix))
    ) {
      indexRef.current = 0
      setDisplayedText("")
    }

    tick()

    return () => {
      if (runIdRef.current === runId) {
        runIdRef.current += 1
      }
      clearTimer()
    }
  }, [targetText, enabled])

  return {
    displayed,
    isAnimating: enabled && displayed.length < targetText.length,
  }
}
