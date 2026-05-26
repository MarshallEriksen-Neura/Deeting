import useSWR from "swr"

import {
  fetchLocalFrameRouteOverlapReadiness,
  isLocalFrameRouteOverlapReadinessWindowValid,
  type LocalFrameRouteOverlapReadiness,
  type LocalFrameRouteOverlapReadinessParams,
} from "@/lib/api/admin-dashboard"
import { isTauriCommandRuntime } from "@/lib/runtime/tauri"

import type { SWRResult } from "./fetcher"

const DAY_MS = 24 * 60 * 60 * 1000
export const FRAME_ROUTE_OVERLAP_READINESS_WINDOW_MS = 14 * DAY_MS

export type FrameRouteOverlapReadinessQuery = LocalFrameRouteOverlapReadinessParams

export type FrameRouteOverlapReadinessOptions = {
  enabled?: boolean
}

type FrameRouteOverlapReadinessKey = [
  "local-frame-route-overlap-readiness",
  number | undefined,
  number | undefined,
]

export const getFrameRouteOverlapReadinessWindow = (
  nowUnixMs = Date.now()
): Required<FrameRouteOverlapReadinessQuery> => {
  const windowEndUnixMs = Number.isFinite(nowUnixMs)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(nowUnixMs)))
    : 0

  return {
    windowStartUnixMs: Math.max(
      0,
      windowEndUnixMs - FRAME_ROUTE_OVERLAP_READINESS_WINDOW_MS
    ),
    windowEndUnixMs,
  }
}

export function isFrameRouteOverlapReadinessQueryValid(
  query: FrameRouteOverlapReadinessQuery | undefined
) {
  return isLocalFrameRouteOverlapReadinessWindowValid(query)
}

export const getFrameRouteOverlapReadinessKey = (
  query: FrameRouteOverlapReadinessQuery | undefined,
  options?: FrameRouteOverlapReadinessOptions
): FrameRouteOverlapReadinessKey | null => {
  if (options?.enabled === false) return null
  if (!isFrameRouteOverlapReadinessRuntime()) return null
  if (!isFrameRouteOverlapReadinessQueryValid(query)) return null

  return [
    "local-frame-route-overlap-readiness",
    query?.windowStartUnixMs,
    query?.windowEndUnixMs,
  ]
}

export function isFrameRouteOverlapReadinessRuntime() {
  return isTauriCommandRuntime()
}

export function useFrameRouteOverlapReadiness(
  query: FrameRouteOverlapReadinessQuery | undefined,
  options?: FrameRouteOverlapReadinessOptions
): SWRResult<LocalFrameRouteOverlapReadiness, Error> {
  const key = getFrameRouteOverlapReadinessKey(query, options)

  return useSWR<
    LocalFrameRouteOverlapReadiness,
    Error,
    FrameRouteOverlapReadinessKey | null
  >(
    key,
    ([, windowStartUnixMs, windowEndUnixMs]: FrameRouteOverlapReadinessKey) =>
      fetchLocalFrameRouteOverlapReadiness({ windowStartUnixMs, windowEndUnixMs })
  )
}
