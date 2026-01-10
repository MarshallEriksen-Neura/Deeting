"use client"

import useSWR from "swr"

import { request } from "@/lib/http"

const MODELS_ENDPOINT = "/api/v1/models/available"

export interface AvailableModelsResponse {
  items: string[]
}

export function useAvailableModels() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<AvailableModelsResponse>(
    MODELS_ENDPOINT,
    () => request<AvailableModelsResponse>({ url: MODELS_ENDPOINT, method: "GET" }),
    {
      revalidateOnFocus: false,
    }
  )

  return {
    models: data?.items ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh: mutate,
  }
}
