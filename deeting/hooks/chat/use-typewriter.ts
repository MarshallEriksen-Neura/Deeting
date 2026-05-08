import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

type TypewriterMode = "default" | "streaming" | "settling"

type TypewriterOptions = {
  enabled?: boolean
  mode?: TypewriterMode
  sourceKey?: string
}

type TypewriterResult = {
  displayed: string
  isAnimating: boolean
}

type TypewriterProfile = {
  baseChunkSize: number
  maxChunkSize: number
  accelerateAt: number
  tickMs: number
  idleTickMs: number
  minChunkSize: number
  boundaryLookahead: number
  initialBurstSize: number
}

const DEFAULT_SOURCE_KEY = "__default__"

function enqueueDisplayedUpdate(
  setDisplayed: Dispatch<SetStateAction<string>>,
  nextDisplayed: string
) {
  queueMicrotask(() => {
    setDisplayed((currentDisplayed) =>
      currentDisplayed === nextDisplayed ? currentDisplayed : nextDisplayed
    )
  })
}

function normalizeOptions(
  optionsOrEnabled: boolean | TypewriterOptions | undefined
): Required<TypewriterOptions> {
  if (typeof optionsOrEnabled === "boolean") {
    return {
      enabled: optionsOrEnabled,
      mode: "default",
      sourceKey: DEFAULT_SOURCE_KEY,
    }
  }

  return {
    enabled: optionsOrEnabled?.enabled ?? false,
    mode: optionsOrEnabled?.mode ?? "default",
    sourceKey: optionsOrEnabled?.sourceKey ?? DEFAULT_SOURCE_KEY,
  }
}

function resolveProfile(mode: TypewriterMode): TypewriterProfile {
  switch (mode) {
    case "streaming":
      return {
        baseChunkSize: 12,
        maxChunkSize: 48,
        accelerateAt: 32,
        tickMs: 34,
        idleTickMs: 48,
        minChunkSize: 8,
        boundaryLookahead: 12,
        initialBurstSize: 24,
      }
    case "settling":
      return {
        baseChunkSize: 8,
        maxChunkSize: 28,
        accelerateAt: 40,
        tickMs: 22,
        idleTickMs: 40,
        minChunkSize: 4,
        boundaryLookahead: 10,
        initialBurstSize: 16,
      }
    default:
      return {
        baseChunkSize: 4,
        maxChunkSize: 18,
        accelerateAt: 48,
        tickMs: 20,
        idleTickMs: 40,
        minChunkSize: 2,
        boundaryLookahead: 8,
        initialBurstSize: 10,
      }
  }
}

function isBoundaryChar(char: string) {
  return /\s|[，,、;；。！？.!?:：)\]}>"'`]/.test(char)
}

function resolveChunkSize(pending: number, profile: TypewriterProfile) {
  const boost = Math.max(0, Math.ceil(pending / profile.accelerateAt) - 1)
  return Math.min(
    profile.maxChunkSize,
    profile.baseChunkSize + boost * 4
  )
}

function resolveBoundaryAwareSliceSize(
  backlog: string,
  desired: number,
  profile: TypewriterProfile
) {
  if (backlog.length <= desired) return backlog.length

  const minSliceSize = Math.min(profile.minChunkSize, desired)
  const preferredWindow = Math.min(
    backlog.length,
    desired + profile.boundaryLookahead
  )

  for (let cursor = desired; cursor >= minSliceSize; cursor -= 1) {
    if (isBoundaryChar(backlog[cursor - 1] ?? "")) {
      return cursor
    }
  }

  for (let cursor = desired + 1; cursor <= preferredWindow; cursor += 1) {
    if (isBoundaryChar(backlog[cursor - 1] ?? "")) {
      return cursor
    }
  }

  return desired
}

export function useTypewriter(
  targetText: string,
  optionsOrEnabled?: boolean | TypewriterOptions
): TypewriterResult {
  const options = normalizeOptions(optionsOrEnabled)
  const normalizedTargetText = targetText ?? ""

  const [displayed, setDisplayed] = useState(
    options.enabled ? "" : normalizedTargetText
  )
  const displayedRef = useRef(displayed)
  const backlogRef = useRef("")
  const fullTextRef = useRef(options.enabled ? "" : normalizedTargetText)
  const sourceKeyRef = useRef(options.sourceKey)

  useEffect(() => {
    const sourceKeyChanged = options.sourceKey !== sourceKeyRef.current
    if (sourceKeyChanged) {
      sourceKeyRef.current = options.sourceKey
      backlogRef.current = ""
      fullTextRef.current = options.enabled ? "" : normalizedTargetText
      displayedRef.current = options.enabled ? "" : normalizedTargetText
      enqueueDisplayedUpdate(
        setDisplayed,
        options.enabled ? "" : normalizedTargetText
      )
    }

    if (!options.enabled) {
      backlogRef.current = ""
      fullTextRef.current = normalizedTargetText
      displayedRef.current = normalizedTargetText
      enqueueDisplayedUpdate(setDisplayed, normalizedTargetText)
      return
    }

    if (
      normalizedTargetText.length < fullTextRef.current.length ||
      (displayedRef.current &&
        !normalizedTargetText.startsWith(displayedRef.current))
    ) {
      backlogRef.current = normalizedTargetText
      fullTextRef.current = normalizedTargetText
      displayedRef.current = ""
      enqueueDisplayedUpdate(setDisplayed, "")
      return
    }

    if (normalizedTargetText !== fullTextRef.current) {
      const delta = normalizedTargetText.slice(fullTextRef.current.length)
      fullTextRef.current = normalizedTargetText
      if (delta) {
        backlogRef.current += delta
      }
    }
  }, [normalizedTargetText, options.enabled, options.sourceKey])

  useEffect(() => {
    if (!options.enabled) return

    const profile = resolveProfile(options.mode)
    let canceled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = () => {
      if (canceled) return

      const pending = backlogRef.current.length
      if (pending === 0) {
        timer = setTimeout(tick, profile.idleTickMs)
        return
      }

      let desiredSliceSize = resolveChunkSize(pending, profile)
      if (displayedRef.current.length === 0) {
        desiredSliceSize = Math.max(
          desiredSliceSize,
          profile.initialBurstSize
        )
      }

      const sliceSize = resolveBoundaryAwareSliceSize(
        backlogRef.current,
        desiredSliceSize,
        profile
      )
      const nextChunk = backlogRef.current.slice(0, sliceSize)
      backlogRef.current = backlogRef.current.slice(sliceSize)

      const nextDisplayed = displayedRef.current + nextChunk
      displayedRef.current = nextDisplayed
      setDisplayed(nextDisplayed)

      timer = setTimeout(tick, profile.tickMs)
    }

    timer = setTimeout(tick, profile.tickMs)
    return () => {
      canceled = true
      if (timer) clearTimeout(timer)
    }
  }, [options.enabled, options.mode])

  return {
    displayed: options.enabled ? displayed : normalizedTargetText,
    isAnimating:
      options.enabled && displayed.length < normalizedTargetText.length,
  }
}
