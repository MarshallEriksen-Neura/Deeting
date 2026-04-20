"use client"

import useSWR from "swr"

import { fetchAvailableModels, type AvailableModelsResponse } from "@/lib/api/models"

const AVAILABLE_MODELS_QUERY_KEY = "/api/v1/models/available"

interface UseAvailableModelsOptions {
  enabled?: boolean
}

export function useAvailableModels(options?: UseAvailableModelsOptions) {
  const key = options?.enabled === false ? null : AVAILABLE_MODELS_QUERY_KEY
  const { data, error, isLoading, mutate, isValidating } = useSWR<AvailableModelsResponse>(
    key,
    fetchAvailableModels,
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
