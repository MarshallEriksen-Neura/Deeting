import { apiClient } from "@/lib/http"

const MODEL_FILES_BASE = "/api/v1/internal/files"

export interface UploadModelFileParams {
  file: File
  purpose?: string
  model?: string
  providerModelId?: string
}

export interface ModelFileUploadResponse {
  id: string
  object?: string
  purpose?: string
  filename?: string
  [key: string]: unknown
}

export async function uploadModelFile(
  params: UploadModelFileParams
): Promise<ModelFileUploadResponse> {
  const formData = new FormData()
  formData.append("file", params.file)
  formData.append("purpose", params.purpose ?? "assistants")
  if (params.model) {
    formData.append("model", params.model)
  }
  if (params.providerModelId) {
    formData.append("provider_model_id", params.providerModelId)
  }

  const { data } = await apiClient.post<ModelFileUploadResponse>(
    MODEL_FILES_BASE,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    }
  )

  return data
}
