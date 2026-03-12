import type {
  ImageGenerationTaskDetail,
  ImageGenerationTaskItem,
} from "@/lib/api/image-generation"
import type { ImageResultPanelPayload } from "@/components/image/image-result-panel"

type ImageTaskLike =
  | ImageGenerationTaskItem
  | ImageGenerationTaskDetail

export function resolveImagePreviewUrl(task: ImageTaskLike): string | null {
  if ("preview" in task && task.preview) {
    return task.preview.asset_url ?? task.preview.source_url ?? null
  }
  const first = "outputs" in task ? task.outputs?.[0] : undefined
  return first?.asset_url ?? first?.source_url ?? null
}

export function buildImageResultPanelPayloadFromTask(
  task: ImageTaskLike,
  options?: {
    prompt?: string | null
    model?: string | null
  }
): ImageResultPanelPayload {
  const outputs = "outputs" in task ? (task.outputs ?? []) : []
  const preview =
    "preview" in task
      ? task.preview ?? outputs[0] ?? null
      : outputs[0] ?? null

  return {
    preview,
    outputs,
    prompt: options?.prompt ?? ("prompt" in task ? task.prompt ?? null : null),
    model: options?.model ?? task.model ?? null,
  }
}
