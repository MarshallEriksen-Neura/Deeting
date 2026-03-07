import { apiClient, getAuthToken, refreshAccessToken } from "./client"

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
  includeAuthHeader?: boolean
  method?: RequestInit["method"]
  body?: RequestInit["body"]
  credentials?: RequestCredentials
  /**
   * 若需自定义关闭，可传入外部的 AbortSignal。
   */
  signal?: AbortSignal
  onOpen?: () => void
  onMessage: (msg: SSEMessage<T>) => void
  onError?: (err: Error) => void
  onClose?: () => void
}

/**
 * 基于 Fetch 的通用 SSE 订阅（浏览器环境）。
 * axios 在浏览器中基于 XHR，不支持 SSE 流式；使用 fetch+ReadableStream 解析。
 */
export function openSSE<T = unknown>(url: string, options: SSEOptions<T>) {
  const {
    parseJson = true,
    headers,
    includeAuthHeader = true,
    method = "GET",
    body,
    credentials = "include",
    signal,
    onOpen,
    onMessage,
    onError,
    onClose,
  } = options

  const controller = new AbortController()
  const mergeSignal = signal
    ? anyToAbortSignal(signal, controller)
    : controller.signal

  void connectWithRetry(true)

  return () => controller.abort()

  async function connectWithRetry(allowRefresh: boolean) {
    try {
      const token = includeAuthHeader ? getAuthToken() : null
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body } : {}),
        credentials,
        signal: mergeSignal,
        cache: "no-store",
      })

      if (includeAuthHeader && response.status === 401 && allowRefresh) {
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

      onClose?.()
    } catch (err) {
      if (mergeSignal.aborted) return
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

export function openApiSSE<T = unknown>(
  path: string,
  options: SSEOptions<T>
) {
  const url = apiClient.getUri({ url: path })
  return openSSE<T>(url, options)
}

function parseEventChunk(chunk: string): SSEMessage<string> | null {
  const dataLines: string[] = []
  const message: SSEMessage<string> = { data: "" }
  let hasDataField = false

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    const trimmed = line.trim()

    if (!trimmed) continue
    if (trimmed.startsWith(":")) continue

    if (line.startsWith("data:")) {
      hasDataField = true
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

    // 兼容部分代理/网关对超长 data 行的折行（非标准，但线上常见）：
    // 若已经开始 data 字段，且当前行不是已知字段前缀，则视为 data 续行。
    // 注意：必须直接拼接到上一条 data 行末尾（不加换行符），
    // 否则换行符会插入 JSON 字符串值内部，导致 JSON.parse 失败。
    if (hasDataField) {
      if (dataLines.length > 0) {
        dataLines[dataLines.length - 1] += line
      } else {
        dataLines.push(line)
      }
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
