"use client"

import { useEffect, useRef } from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import type { ModelInfo } from "@/lib/api/models"

interface UseChatModelsProps {
  models: ModelInfo[]
  isLoadingModels: boolean
}

export function useChatModels({ models, isLoadingModels }: UseChatModelsProps) {
  const { config, setModels, setConfig } = useChatStateStore()
  const hasInitializedRef = useRef(false)

  // 同步模型列表到 store
  useEffect(() => {
    if (models.length === 0) return

    setModels(models)

    // 使用 getState() 获取当前值，避免将 config.model 放入依赖导致无限循环
    const currentModel = useChatStateStore.getState().config.model

    // 检查当前选中的模型是否还存在
    const hasSelectedModel = currentModel
      ? models.some((model) => model.id === currentModel || model.provider_model_id === currentModel)
      : false

    // 如果没有选中模型或选中的模型不存在，则选择第一个模型
    if (!hasSelectedModel && models[0] && !hasInitializedRef.current) {
      setConfig({ model: models[0].provider_model_id ?? models[0].id })
      hasInitializedRef.current = true
    } else if (hasSelectedModel) {
      hasInitializedRef.current = true
    }
  }, [models, setModels, setConfig])

  const handleModelChange = (modelId: string) => {
    setConfig({ model: modelId })
  }

  return {
    selectedModelId: config.model,
    handleModelChange,
    isLoadingModels,
  }
}