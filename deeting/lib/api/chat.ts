import { openApiSSE, request } from "@/lib/http"
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
  assistant_id?: string
  session_id?: string
  regenerate?: boolean
  context?: LocalContextSnapshot | any
}

export type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  session_id?: string | null
}

const CHAT_COMPLETIONS_PATH = "/api/v1/internal/chat/completions"

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
  // Auto-collect local context for JIT orchestration if not provided
  const localContext = payload.context ?? (await collectLocalContext())

  const body = JSON.stringify({
    ...payload,
    context: localContext,
    stream: payload.stream ?? true,
    status_stream: payload.status_stream ?? true,
  })
  let fullText = ""
  let settled = false

  return await new Promise<string>((resolve, reject) => {
    const close = openApiSSE(CHAT_COMPLETIONS_PATH, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
      },
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
          typeof data === "string" || data === null ? null : (data as any)

        // ── LOG BACKFILL ──────────────────────────────────────────
        if (parsed?.usage && process.env.NEXT_PUBLIC_IS_TAURI === "true") {
          const usage = parsed.usage
          invokeTauri("create_local_gateway_log", {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            trace_id: parsed.trace_id || payload.request_id,
            model: payload.model,
            status_code: 200,
            duration_ms: parsed.duration_ms || 0,
            ttft_ms: parsed.ttft_ms,
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0,
            cost_user: parsed.billing?.amount || 0,
            created_at: new Date().toISOString(),
          }).catch(err => console.warn("[ChatAPI] Local log backfill failed", err))
        }
        // ────────────────────────────────────────────────────────────

        const delta =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.choices?.[0]?.message?.content ??
          ""
        if (delta) {
          fullText += delta
          handlers.onDelta?.(delta, fullText)
        }
      },
      onError: (err) => {
        if (settled) return
        settled = true
        reject(err)
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
