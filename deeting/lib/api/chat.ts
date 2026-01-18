import { openApiSSE, request } from "@/lib/http"

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ChatCompletionRequest = {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  status_stream?: boolean
  temperature?: number
  max_tokens?: number
  provider_model_id?: string
  assistant_id?: string
  session_id?: string
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
  } = {}
): Promise<string> {
  const body = JSON.stringify({
    ...payload,
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
  })
}
