import { getAuthToken, refreshAccessToken } from "./client"

export interface SSEMessage<T = string> {
  event?: string
  id?: string
  retry?: number
  data: T
}

export interface SSEOptions<T = unknown> {
  /**
   * 默认尝试将 data 解析为 JSON，失败则回落为 string。
   */
  parseJson?: boolean
  headers?: Record<string, string>
  /**
   * 若需自定义关闭，可传入外部的 AbortSignal。
   */
  signal?: AbortSignal
  onOpen?: () => void
  onMessage: (msg: SSEMessage<T>) => void
  onError?: (err: Error) => void
}

/**
 * 基于 Fetch 的通用 SSE 订阅（浏览器环境）。
 * axios 在浏览器中基于 XHR，不支持 SSE 流式；使用 fetch+ReadableStream 解析。
 */
export function openSSE<T = unknown>(url: string, options: SSEOptions<T>) {
  const {
    parseJson = true,
    headers,
    signal,
    onOpen,
    onMessage,
    onError,
  } = options

  const controller = new AbortController()
  const mergeSignal = signal
    ? anyToAbortSignal(signal, controller)
    : controller.signal

  void connectWithRetry(true)

  return () => controller.abort()

  async function connectWithRetry(allowRefresh: boolean) {
    try {
      const token = getAuthToken()
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        credentials: "include",
        signal: mergeSignal,
        cache: "no-store",
      })

      if (response.status === 401 && allowRefresh) {
        const newToken = await refreshAccessToken().catch(() => null)
        if (newToken) {
          await connectWithRetry(false)
          return
        }
      }

      if (!response.ok || !response.body) {
        throw new Error(`SSE 连接失败: ${response.status} ${response.statusText}`)
      }

      onOpen?.()

      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""

        for (const chunk of parts) {
          const parsed = parseEventChunk(chunk)
          if (!parsed) continue
          const data = parseJson ? safeJson(parsed.data) : (parsed.data as T)
          onMessage({ ...parsed, data })
        }
      }
    } catch (err) {
      if (mergeSignal.aborted) return
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

function parseEventChunk(chunk: string): SSEMessage<string> | null {
  const dataLines: string[] = []
  const message: SSEMessage<string> = { data: "" }

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }
    if (line.startsWith("event:")) {
      message.event = line.slice(6).trimStart()
      continue
    }
    if (line.startsWith("id:")) {
      message.id = line.slice(3).trimStart()
      continue
    }
    if (line.startsWith("retry:")) {
      const retry = Number.parseInt(line.slice(6).trimStart(), 10)
      if (!Number.isNaN(retry)) message.retry = retry
      continue
    }
  }

  message.data = dataLines.join("\n")
  return message
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function anyToAbortSignal(source: AbortSignal, controller: AbortController) {
  const linked = controller.signal
  source.addEventListener("abort", () => controller.abort(), { once: true })
  return linked
}
