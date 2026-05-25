"use client"

import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/store/chat-store"
import {
  matchesChatModelSelectionValue,
  resolveChatModelSelectionValue,
  type ModelInfo,
} from "@/lib/api/models"

interface UseChatModelsProps {
  models: ModelInfo[]
  isLoadingModels: boolean
}

export function useChatModels({ models, isLoadingModels }: UseChatModelsProps) {
  const { config, setModels, setConfig } = useChatStore(
    useShallow((state) => ({
      config: state.config,
      setModels: state.setModels,
      setConfig: state.setConfig,
    }))
  )
  const hasInitializedRef = useRef(false)

  // 同步模型列表到 store
  useEffect(() => {
    if (models.length === 0) return

    setModels(models)

    // 使用 getState() 获取当前值，避免将 config.model 放入依赖导致无限循环
    const currentModel = useChatStore.getState().config.model

    // 检查当前选中的模型是否还存在
    const hasSelectedModel = currentModel
      ? models.some((model) => matchesChatModelSelectionValue(model, currentModel))
      : false

    const legacySelectedModel = currentModel
      ? models.find(
          (model) =>
            model.provider_model_id === currentModel &&
            resolveChatModelSelectionValue(model) !== currentModel
        )
      : undefined

    if (legacySelectedModel) {
      setConfig({ model: resolveChatModelSelectionValue(legacySelectedModel) })
      hasInitializedRef.current = true
      return
    }

    // 如果没有选中模型或选中的模型不存在，则选择第一个模型
    if (!hasSelectedModel && models[0] && !hasInitializedRef.current) {
      setConfig({ model: resolveChatModelSelectionValue(models[0]) })
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
