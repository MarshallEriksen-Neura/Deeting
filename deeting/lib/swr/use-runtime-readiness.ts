import useSWR from "swr"

import {
  fetchLocalFramePhaseAlignmentReadiness,
  isLocalFramePhaseAlignmentReadinessWindowValid,
  type LocalFramePhaseAlignmentReadiness,
  type LocalFramePhaseAlignmentReadinessParams,
} from "@/lib/api/admin-dashboard"
import { isTauriCommandRuntime } from "@/lib/runtime/tauri"

import type { SWRResult } from "./fetcher"

const DAY_MS = 24 * 60 * 60 * 1000
export const FRAME_PHASE_ALIGNMENT_READINESS_WINDOW_MS = 14 * DAY_MS

export type FramePhaseAlignmentReadinessQuery = LocalFramePhaseAlignmentReadinessParams

export type FramePhaseAlignmentReadinessOptions = {
  enabled?: boolean
}

type FramePhaseAlignmentReadinessKey = [
  "local-frame-phase-alignment-readiness",
  number | undefined,
  number | undefined,
]

export const getFramePhaseAlignmentReadinessWindow = (
  nowUnixMs = Date.now()
): Required<FramePhaseAlignmentReadinessQuery> => {
  const windowEndUnixMs = Number.isFinite(nowUnixMs)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(nowUnixMs)))
    : 0

  return {
    windowStartUnixMs: Math.max(
      0,
      windowEndUnixMs - FRAME_PHASE_ALIGNMENT_READINESS_WINDOW_MS
    ),
    windowEndUnixMs,
  }
}

export function isFramePhaseAlignmentReadinessQueryValid(
  query: FramePhaseAlignmentReadinessQuery | undefined
) {
  return isLocalFramePhaseAlignmentReadinessWindowValid(query)
}

export const getFramePhaseAlignmentReadinessKey = (
  query: FramePhaseAlignmentReadinessQuery | undefined,
  options?: FramePhaseAlignmentReadinessOptions
): FramePhaseAlignmentReadinessKey | null => {
  if (options?.enabled === false) return null
  if (!isFramePhaseAlignmentReadinessRuntime()) return null
  if (!isFramePhaseAlignmentReadinessQueryValid(query)) return null

  return [
    "local-frame-phase-alignment-readiness",
    query?.windowStartUnixMs,
    query?.windowEndUnixMs,
  ]
}

export function isFramePhaseAlignmentReadinessRuntime() {
  return isTauriCommandRuntime()
}

export function useFramePhaseAlignmentReadiness(
  query: FramePhaseAlignmentReadinessQuery | undefined,
  options?: FramePhaseAlignmentReadinessOptions
): SWRResult<LocalFramePhaseAlignmentReadiness, Error> {
  const key = getFramePhaseAlignmentReadinessKey(query, options)

  return useSWR<
    LocalFramePhaseAlignmentReadiness,
    Error,
    FramePhaseAlignmentReadinessKey | null
  >(
    key,
    ([, windowStartUnixMs, windowEndUnixMs]: FramePhaseAlignmentReadinessKey) =>
      fetchLocalFramePhaseAlignmentReadiness({ windowStartUnixMs, windowEndUnixMs })
  )
}
