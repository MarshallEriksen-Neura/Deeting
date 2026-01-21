"use client"

import { useEffect } from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import type { ModelInfo } from "@/lib/api/models"

interface UseChatModelsProps {
  models: ModelInfo[]
  isLoadingModels: boolean
}

export function useChatModels({ models, isLoadingModels }: UseChatModelsProps) {
  const { config, setModels, setConfig } = useChatStateStore()

  // 同步模型列表到 store
  useEffect(() => {
    setModels(models)
    
    if (models.length === 0) return
    
    // 检查当前选中的模型是否还存在
    const hasSelectedModel = config.model
      ? models.some((model) => model.id === config.model || model.provider_model_id === config.model)
      : false
    
    // 如果没有选中模型或选中的模型不存在，则选择第一个模型
    if (!hasSelectedModel && models[0]) {
      setConfig({ model: models[0].provider_model_id ?? models[0].id })
    }
  }, [models, setModels, config.model, setConfig])

  const handleModelChange = (modelId: string) => {
    setConfig({ model: modelId })
  }

  return {
    selectedModelId: config.model,
    handleModelChange,
    isLoadingModels,
  }
}