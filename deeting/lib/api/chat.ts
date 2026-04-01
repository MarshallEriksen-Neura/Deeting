import { openApiSSE, openSSE, request } from "@/lib/http"
import type { ChatMessageContent } from "@/lib/chat/message-content"
import { collectLocalContext, type LocalContextSnapshot } from "@/lib/platform/context-collector"
import { invoke as invokeTauri } from "@tauri-apps/api/core"

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: ChatMessageContent
}

export type ChatCompletionRequest = {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  status_stream?: boolean
  temperature?: number
  max_tokens?: number
  request_id?: string
  provider_model_id?: string
  explicit_task_agent_id?: string
  assistant_id?: string
  session_id?: string
  regenerate?: boolean
  compare_only?: boolean
  context?: LocalContextSnapshot | unknown
  metadata?: Record<string, unknown>
}

export type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  session_id?: string | null
}

export type LocalConversationCompareFinalizeRequest = {
  session_id: string
  model_id: string
  provider_model_id?: string
  content: string
  blocks?: unknown[]
}

export type LocalConversationCompareFinalizeResponse = {
  session_id: string
  replaced_turn_index: number
  message: Record<string, unknown>
}

const CHAT_COMPLETIONS_PATH = "/api/v1/internal/chat/completions"
const LOCAL_GATEWAY_CHAT_PATH = "/v1/chat/completions"
const LOCAL_GATEWAY_COMPARE_FINALIZE_PATH = "/v1/chat/comparisons/finalize"
const LOCAL_GATEWAY_URL_COMMAND = "get_local_gateway_url"
const LOCAL_GATEWAY_RESOLVE_MAX_RETRIES = 50
const LOCAL_GATEWAY_RESOLVE_INTERVAL_MS = 120

let localGatewayBaseUrlCache: string | null = null
let localGatewayBaseUrlInflight: Promise<string> | null = null

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

async function resolveLocalGatewayBaseUrl() {
  if (localGatewayBaseUrlCache) return localGatewayBaseUrlCache
  if (localGatewayBaseUrlInflight) return localGatewayBaseUrlInflight

  localGatewayBaseUrlInflight = (async () => {
    if (!isTauriRuntime()) {
      throw new Error("Local gateway is only available in Tauri runtime")
    }

    let lastError: unknown = null
    for (let index = 0; index < LOCAL_GATEWAY_RESOLVE_MAX_RETRIES; index += 1) {
      try {
        const value = await invokeTauri<string | null>(LOCAL_GATEWAY_URL_COMMAND)
        const normalized = typeof value === "string" ? value.trim() : ""
        if (normalized) {
          localGatewayBaseUrlCache = normalized
          return normalized
        }
      } catch (error) {
        lastError = error
      }
      await sleep(LOCAL_GATEWAY_RESOLVE_INTERVAL_MS)
    }

    throw new Error(
      lastError instanceof Error
        ? `Local gateway unavailable: ${lastError.message}`
        : "Local gateway unavailable"
    )
  })()

  try {
    return await localGatewayBaseUrlInflight
  } finally {
    localGatewayBaseUrlInflight = null
  }
}

export async function createChatCompletion(payload: ChatCompletionRequest) {
  return request<ChatCompletionResponse>({
    url: CHAT_COMPLETIONS_PATH,
    method: "POST",
    data: payload,
  })
}

export async function streamChatCompletion(
  payload: ChatCompletionRequest,
  handlers: {
    onDelta?: (delta: string, snapshot: string) => void
    onMessage?: (data: unknown) => void
  } = {},
  control: {
    onCancel?: (cancel: () => void) => void
  } = {}
): Promise<string> {
  const localContext = payload.context ?? (await collectLocalContext())
  const body = JSON.stringify({
    ...payload,
    context: localContext,
    stream: payload.stream ?? true,
    status_stream: payload.status_stream ?? true,
  })

  return streamViaSse(
    (callbacks) =>
      openApiSSE(CHAT_COMPLETIONS_PATH, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
        },
        onMessage: callbacks.onMessage,
        onError: callbacks.onError,
        onClose: callbacks.onClose,
      }),
    payload,
    handlers,
    control
  )
}

export async function streamDesktopLocalChatCompletion(
  payload: ChatCompletionRequest,
  handlers: {
    onDelta?: (delta: string, snapshot: string) => void
    onMessage?: (data: unknown) => void
  } = {},
  control: {
    onCancel?: (cancel: () => void) => void
  } = {}
): Promise<string> {
  const localContext = payload.context ?? (await collectLocalContext())
  const baseUrl = await resolveLocalGatewayBaseUrl()
  const body = JSON.stringify({
    ...payload,
    context: localContext,
    stream: payload.stream ?? true,
    status_stream: payload.status_stream ?? true,
  })

  return streamViaSse(
    (callbacks) =>
      openSSE(`${baseUrl}${LOCAL_GATEWAY_CHAT_PATH}`, {
        method: "POST",
        body,
        credentials: "omit",
        includeAuthHeader: false,
        headers: {
          "Content-Type": "application/json",
        },
        onMessage: callbacks.onMessage,
        onError: callbacks.onError,
        onClose: callbacks.onClose,
      }),
    payload,
    handlers,
    control
  )
}

export async function finalizeDesktopLocalCompare(
  payload: LocalConversationCompareFinalizeRequest
) {
  const baseUrl = await resolveLocalGatewayBaseUrl()
  return request<LocalConversationCompareFinalizeResponse>({
    url: `${baseUrl}${LOCAL_GATEWAY_COMPARE_FINALIZE_PATH}`,
    method: "POST",
    data: payload,
    anonymous: true,
  })
}

type StreamOpenCallbacks = {
  onMessage: (message: { data: unknown }) => void
  onError: (error: Error) => void
  onClose: () => void
}

export function extractStreamDeltaContent(data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const parsedMessage = data as {
    choices?: Array<{
      delta?: {
        content?: string
      }
    }>
  }

  return parsedMessage?.choices?.[0]?.delta?.content ?? ""
}

async function streamViaSse(
  open: (callbacks: StreamOpenCallbacks) => () => void,
  payload: ChatCompletionRequest,
  handlers: {
    onDelta?: (delta: string, snapshot: string) => void
    onMessage?: (data: unknown) => void
  },
  control: {
    onCancel?: (cancel: () => void) => void
  }
) {
  let fullText = ""
  let settled = false

  return await new Promise<string>((resolve, reject) => {
    const close = open({
      onMessage: (message) => {
        const data = message.data
        if (data === "[DONE]") {
          if (settled) return
          settled = true
          close()
          resolve(fullText)
          return
        }

        handlers.onMessage?.(data)
        const parsed =
          typeof data === "string" || data === null
            ? null
            : (data as Record<string, unknown>)
        const parsedMessage = parsed as
          | {
              usage?: {
                prompt_tokens?: number
                completion_tokens?: number
                total_tokens?: number
                cached_tokens?: number
                cache_read_input_tokens?: number
                cache_creation_input_tokens?: number
                cache_write_input_tokens?: number
                prompt_tokens_details?: {
                  cached_tokens?: number
                }
              }
              trace_id?: string
              duration_ms?: number
              ttft_ms?: number
              billing?: {
                amount?: number
              }
              choices?: Array<{
                delta?: {
                  content?: string
                }
              }>
            }
          | null

        if (parsedMessage?.usage && process.env.NEXT_PUBLIC_IS_TAURI === "true") {
          const usage = parsedMessage.usage
          const cachedTokens =
            usage.prompt_tokens_details?.cached_tokens ??
            usage.cached_tokens ??
            usage.cache_read_input_tokens
          const cacheReadInputTokens =
            usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens
          const cacheWriteInputTokens =
            usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens
          const requestCacheHit =
            typeof cachedTokens === "number" ? cachedTokens > 0 : false
          const meta =
            typeof cachedTokens === "number" ||
            typeof cacheReadInputTokens === "number" ||
            typeof cacheWriteInputTokens === "number"
              ? {
                  usage_normalized: {
                    usage_source: "provider_reported",
                    request_cache_hit: requestCacheHit,
                    cache_source: requestCacheHit ? "provider_reported" : "unknown",
                    ...(typeof cachedTokens === "number"
                      ? { cached_tokens: cachedTokens }
                      : {}),
                    ...(typeof cacheReadInputTokens === "number"
                      ? { cache_read_input_tokens: cacheReadInputTokens }
                      : {}),
                    ...(typeof cacheWriteInputTokens === "number"
                      ? { cache_write_input_tokens: cacheWriteInputTokens }
                      : {}),
                  },
                  provider_usage_raw: usage,
                }
              : undefined
          invokeTauri("create_local_gateway_log", {
            payload: {
              id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              trace_id: parsedMessage.trace_id || payload.request_id,
              user_id: null,
              api_key_id: null,
              preset_id: null,
              model: payload.model,
              status_code: 200,
              duration_ms: parsedMessage.duration_ms || 0,
              ttft_ms: parsedMessage.ttft_ms,
              input_tokens: usage.prompt_tokens || 0,
              output_tokens: usage.completion_tokens || 0,
              total_tokens: usage.total_tokens || 0,
              cost_upstream: parsedMessage.billing?.amount || 0,
              cost_user: parsedMessage.billing?.amount || 0,
              is_cached: requestCacheHit,
              error_code: null,
              meta,
              created_at: new Date().toISOString(),
            },
          }).catch((error) => console.warn("[ChatAPI] Local log backfill failed", error))
        }

        const delta = extractStreamDeltaContent(parsed)
        if (delta) {
          fullText += delta
          handlers.onDelta?.(delta, fullText)
        }
      },
      onError: (error) => {
        if (settled) return
        settled = true
        reject(error)
      },
      onClose: () => {
        if (settled) return
        settled = true
        resolve(fullText)
      },
    })

    const cancel = () => {
      if (settled) return
      settled = true
      close()
      resolve(fullText)
    }
    control.onCancel?.(cancel)
  })
}

export async function cancelChatCompletion(requestId: string) {
  return request<{ request_id: string; status: string }>({
    url: `${CHAT_COMPLETIONS_PATH}/${requestId}/cancel`,
    method: "POST",
  })
}

export async function cancelDesktopLocalChatCompletion(requestId: string) {
  const baseUrl = await resolveLocalGatewayBaseUrl()
  return request<{ request_id: string; status: string }>({
    url: `${baseUrl}${LOCAL_GATEWAY_CHAT_PATH}/${encodeURIComponent(requestId)}/cancel`,
    method: "POST",
  })
}
