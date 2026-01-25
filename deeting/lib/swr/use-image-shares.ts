"use client"

import * as React from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"

import type { ApiError } from "@/lib/http"
import { swrFetcher, type SWRResult } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"
import {
  fetchPublicImageShareDetail,
  fetchPublicImageShares,
  shareImageGenerationTask,
  unshareImageGenerationTask,
  type ImageShareDetail,
  type ImageShareItem,
  type ImageSharePage,
  type ImageShareRequest,
  type ImageShareState,
  type PublicImageShareQuery,
} from "@/lib/api/image-generation"

const PUBLIC_IMAGE_SHARES_KEY = "/api/v1/public/images/shares"

export interface PublicImageSharesState {
  items: ImageShareItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
}

export function usePublicImageShares(
  query: PublicImageShareQuery = {},
  options: { enabled?: boolean } = {}
): PublicImageSharesState {
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (
      pageIndex: number,
      previousPageData: CursorPage<ImageShareItem> | null
    ) => {
      if (options.enabled === false) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor =
        pageIndex === 0 ? (query.cursor ?? null) : previousPageData?.next_page
      return [
        PUBLIC_IMAGE_SHARES_KEY,
        {
          params: {
            cursor,
            size: pageSize,
          },
        },
      ]
    },
    [options.enabled, pageSize, query.cursor]
  )

  const { data, error, isLoading, size, setSize } = useSWRInfinite<
    CursorPage<ImageShareItem>,
    ApiError
  >(getKey, swrFetcher, {
    revalidateOnFocus: false,
  })

  const items = React.useMemo(() => {
    if (!data) return []
    return data.flatMap((page) => page.items || [])
  }, [data])

  const hasMore = React.useMemo(() => {
    if (!data || data.length === 0) return false
    return Boolean(data[data.length - 1]?.next_page)
  }, [data])

  const isLoadingMore =
    isLoading || (size > 0 && !!data && typeof data[size - 1] === "undefined")

  const loadMore = React.useCallback(() => {
    if (hasMore) {
      setSize(size + 1)
    }
  }, [hasMore, setSize, size])

  const reset = React.useCallback(() => {
    setSize(1)
  }, [setSize])

  return {
    items,
    hasMore,
    isLoading,
    isLoadingMore,
    error: error ?? undefined,
    loadMore,
    reset,
  }
}

export function usePublicImageShareDetail(
  shareId: string | null,
  options: { enabled?: boolean } = {}
): SWRResult<ImageShareDetail> {
  const key =
    options.enabled === false || !shareId
      ? null
      : `${PUBLIC_IMAGE_SHARES_KEY}/${shareId}`
  return useSWR<ImageShareDetail, ApiError>(
    key,
    () => fetchPublicImageShareDetail(shareId as string),
    { revalidateOnFocus: false }
  )
}

export interface ImageShareActions {
  share: SWRMutationResponse<
    ImageShareState,
    ApiError,
    string,
    { taskId: string; payload?: ImageShareRequest }
  >
  unshare: SWRMutationResponse<
    ImageShareState,
    ApiError,
    string,
    { taskId: string }
  >
}

export function useImageShareActions(): ImageShareActions {
  const share = useSWRMutation(
    `${PUBLIC_IMAGE_SHARES_KEY}/share`,
    (_key, { arg }: { arg: { taskId: string; payload?: ImageShareRequest } }) =>
      shareImageGenerationTask(arg.taskId, arg.payload ?? {})
  )
  const unshare = useSWRMutation(
    `${PUBLIC_IMAGE_SHARES_KEY}/share`,
    (_key, { arg }: { arg: { taskId: string } }) =>
      unshareImageGenerationTask(arg.taskId)
  )

  return { share, unshare }
}

export type { ImageSharePage, ImageShareDetail }
