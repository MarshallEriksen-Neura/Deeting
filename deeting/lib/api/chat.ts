import { request } from "@/lib/http"
import { getAuthToken, refreshAccessToken } from "@/lib/http/client"

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
  const response = await requestStream(body, true)

  if (!response.ok || !response.body) {
    const message = await readErrorMessage(response)
    throw new Error(message || `请求失败: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let fullText = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""

    for (const part of parts) {
      const data = extractData(part)
      if (!data) continue
      if (data === "[DONE]") {
        return fullText
      }

      const parsed = safeJson(data)
      handlers.onMessage?.(parsed)
      const delta =
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.choices?.[0]?.message?.content ??
        ""
      if (delta) {
        fullText += delta
        handlers.onDelta?.(delta, fullText)
      }
    }
  }

  return fullText

  async function requestStream(bodyText: string, allowRefresh: boolean) {
    const token = resolveAuthToken()
    const response = await fetch(CHAT_COMPLETIONS_PATH, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: bodyText,
    })

    if (response.status === 401 && allowRefresh) {
      const newToken = await refreshAccessToken().catch(() => null)
      if (newToken) {
        return requestStream(bodyText, false)
      }
    }

    return response
  }
}

function resolveAuthToken() {
  const token = getAuthToken()
  if (token) return token
  if (typeof window === "undefined") return null
  try {
    const stored = sessionStorage.getItem("deeting-auth-store")
    if (!stored) return null
    const parsed = JSON.parse(stored)
    return parsed.state?.accessToken ?? null
  } catch {
    return null
  }
}

function extractData(chunk: string) {
  const dataLines: string[] = []
  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  return dataLines.join("\n")
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function readErrorMessage(response: Response) {
  try {
    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string }
      return payload?.message
    }
    const text = await response.text()
    return text || response.statusText
  } catch {
    return response.statusText
  }
}
