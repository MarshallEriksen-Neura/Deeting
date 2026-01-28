import { useEffect, useRef, useState } from "react"

const DEFAULT_BASE_INTERVAL = 28
const MEDIUM_TEXT_LENGTH = 300
const LONG_TEXT_LENGTH = 800
const MEDIUM_INTERVAL = 18
const LONG_INTERVAL = 12
const MIN_INTERVAL = 8
const MAX_INTERVAL = 40
const MAX_DURATION_MS = 7000
const PUNCTUATION_DELAY = 120
const SHORT_PAUSE_DELAY = 60
const NEWLINE_DELAY = 180

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
  const targetRef = useRef(targetText)
  const enabledRef = useRef(enabled)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const tick = () => {
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
      indexRef.current = currentIndex + 1
      setDisplayed(target.slice(0, indexRef.current))
      tick()
    }, delay)
  }

  const start = () => {
    if (timerRef.current) return
    tick()
  }

  useEffect(() => {
    targetRef.current = targetText
    enabledRef.current = enabled

    if (!enabled) {
      clearTimer()
      indexRef.current = targetText.length
      setDisplayed(targetText)
      return
    }

    if (!targetText) {
      clearTimer()
      indexRef.current = 0
      setDisplayed("")
      return
    }

    if (targetText.length < indexRef.current) {
      indexRef.current = 0
      setDisplayed("")
    }

    start()

    return () => {
      clearTimer()
    }
  }, [targetText, enabled])

  return {
    displayed,
    isAnimating: enabledRef.current && displayed.length < targetRef.current.length,
  }
}
