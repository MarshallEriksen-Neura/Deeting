"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"
import { usePlatform } from "@/lib/platform/provider"

import {
  type ApiKey,
  type ApiKeyListResponse,
  type CreateApiKeyRequest,
  type RollApiKeyResponse,
  type UpdateApiKeyRequest,
} from "@/lib/api/api-keys"
import { type ApiError } from "@/lib/http"
import { useAuthStore } from "@/store/auth-store"

const API_KEYS_QUERY_KEY = "/api/v1/api-keys"
const DEFAULT_PAGE_SIZE = 50

type UpdateArgs = { id: string; payload: UpdateApiKeyRequest }

export interface UseApiKeyServiceResult {
  apiKeys: ApiKey[]
  data: ApiKeyListResponse | undefined
  isLoading: boolean
  error: ApiError | undefined
  refresh: () => void
  createKey: (payload: CreateApiKeyRequest) => Promise<{ api_key: ApiKey; secret: string }>
  rollKey: (id: string) => Promise<RollApiKeyResponse>
  revokeKey: (id: string) => Promise<ApiKey>
  updateKey: (id: string, payload: UpdateApiKeyRequest) => Promise<ApiKey>
  deleteKey: (id: string) => Promise<void>
  mutations: {
    create: SWRMutationResponse<{ api_key: ApiKey; secret: string }, ApiError, string, CreateApiKeyRequest>
    roll: SWRMutationResponse<RollApiKeyResponse, ApiError, string, string>
    revoke: SWRMutationResponse<ApiKey, ApiError, string, string>
    update: SWRMutationResponse<ApiKey, ApiError, string, UpdateArgs>
    remove: SWRMutationResponse<void, ApiError, string, string>
  }
}

export function useApiKeyService({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
}: { page?: number; pageSize?: number } = {}): UseApiKeyServiceResult {
  const { isAuthenticated } = useAuthStore()
  const { apiKey } = usePlatform()

  const params = useMemo(
    () => ({
      page,
      page_size: pageSize,
    }),
    [page, pageSize]
  )

  const shouldFetch = isAuthenticated ? [API_KEYS_QUERY_KEY, params] : null

  // Use platform service for fetching
  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<ApiKeyListResponse, ApiError>(shouldFetch, () => apiKey.list(params), {
    keepPreviousData: true,
  })

  // Use platform service for mutations
  const createMutation = useSWRMutation(API_KEYS_QUERY_KEY, (_key, { arg }: { arg: CreateApiKeyRequest }) =>
    apiKey.create(arg)
  )
  const rollMutation = useSWRMutation(`${API_KEYS_QUERY_KEY}/roll`, (_key, { arg }: { arg: string }) =>
    apiKey.roll(arg)
  )
  const revokeMutation = useSWRMutation(`${API_KEYS_QUERY_KEY}/revoke`, (_key, { arg }: { arg: string }) =>
    apiKey.revoke(arg)
  )
  const updateMutation = useSWRMutation(
    `${API_KEYS_QUERY_KEY}/update`,
    (_key, { arg }: { arg: UpdateArgs }) => apiKey.update(arg.id, arg.payload)
  )
  const deleteMutation = useSWRMutation(`${API_KEYS_QUERY_KEY}/delete`, (_key, { arg }: { arg: string }) =>
    apiKey.delete(arg)
  )

  const refresh = useCallback(() => {
    void mutate()
  }, [mutate])

  const appendKey = useCallback(
    async (newKey: ApiKey) =>
      mutate(
        (prev) => {
          if (!prev) {
            return { items: [newKey], total: 1, page, page_size: pageSize }
          }
          return { ...prev, items: [newKey, ...prev.items], total: prev.total + 1 }
        },
        false
      ),
    [mutate, page, pageSize]
  )

  const replaceKey = useCallback(
    async (updatedKey: ApiKey) =>
      mutate(
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.map((item) => (item.id === updatedKey.id ? updatedKey : item)),
          }
        },
        false
      ),
    [mutate]
  )

  const dropKey = useCallback(
    async (id: string) =>
      mutate(
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.filter((item) => item.id !== id),
            total: Math.max(0, prev.total - 1),
          }
        },
        false
      ),
    [mutate]
  )

  const createKey = useCallback(
    async (payload: CreateApiKeyRequest) => {
      const res = await createMutation.trigger(payload)
      await appendKey(res.api_key)
      return res
    },
    [appendKey, createMutation]
  )

  const rollKey = useCallback(
    async (id: string) => {
      const res = await rollMutation.trigger(id)
      await replaceKey(res.api_key)
      return res
    },
    [replaceKey, rollMutation]
  )

  const revokeKey = useCallback(
    async (id: string) => {
      const res = await revokeMutation.trigger(id)
      await replaceKey(res)
      return res
    },
    [replaceKey, revokeMutation]
  )

  const updateKey = useCallback(
    async (id: string, payload: UpdateApiKeyRequest) => {
      const res = await updateMutation.trigger({ id, payload })
      await replaceKey(res)
      return res
    },
    [replaceKey, updateMutation]
  )

  const deleteKey = useCallback(
    async (id: string) => {
      await deleteMutation.trigger(id)
      await dropKey(id)
    },
    [deleteMutation, dropKey]
  )

  return {
    apiKeys: data?.items ?? [],
    data,
    isLoading: Boolean(isLoading || isValidating),
    error,
    refresh,
    createKey,
    rollKey,
    revokeKey,
    updateKey,
    deleteKey,
    mutations: {
      create: createMutation,
      roll: rollMutation,
      revoke: revokeMutation,
      update: updateMutation,
      remove: deleteMutation,
    },
  }
}