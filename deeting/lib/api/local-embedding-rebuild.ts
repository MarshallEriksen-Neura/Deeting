const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function assertDesktopRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("local embedding rebuild is only available in desktop runtime")
  }
}

export const LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT = "local-embedding-rebuild-progress"

export interface LocalEmbeddingRebuildProgressPayload {
  phase: string
  progress: number
  total: number
  processed: number
  indexed: number
  failed: number
  current?: string | null
}

export interface LocalEmbeddingRebuildResponse {
  vector_dimension: number
  total: number
  indexed: number
  failed: number
}

export async function rebuildLocalEmbeddingAssets(): Promise<LocalEmbeddingRebuildResponse> {
  assertDesktopRuntime()
  return invokeTauri<LocalEmbeddingRebuildResponse>("rebuild_local_embedding_assets")
}
