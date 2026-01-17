"use client"

import useSWR from "swr"

import { fetchAvailableModels, type AvailableModelsResponse } from "@/lib/api/models"

const AVAILABLE_MODELS_QUERY_KEY = "/api/v1/models/available"

export function useAvailableModels() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<AvailableModelsResponse>(
    AVAILABLE_MODELS_QUERY_KEY,
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
