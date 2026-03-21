import type { AxiosAdapter, AxiosResponse } from "axios";

// Only load this module if we are definitely in a Tauri environment
// Webpack/Next.js dynamic imports will handle code splitting

export const createTauriAdapter = async (): Promise<AxiosAdapter> => {
  // Dynamic import to avoid breaking server-side rendering or web builds
  // where @tauri-apps/plugin-http might not be resolvable or compatible
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");

  return async (config) => {
    // 1. Build full URL
    // Axios config.url might be relative if baseURL is set, but the adapter 
    // receives the combined URL usually. However, let's ensure it's absolute for Tauri.
    // If config.baseURL is set, axios merges it before calling adapter? 
    // Actually, axios passes the full url in config.url if using baseURL, 
    // but ONLY if the adapter is the default one? 
    // Let's manually construct it to be safe if it's relative.
    
    let fullUrl = config.url || "";
    if (config.baseURL && !fullUrl.startsWith("http")) {
        // Simple join, handling slashes
        const baseUrl = config.baseURL.replace(/\/$/, "");
        const path = fullUrl.replace(/^\//, "");
        fullUrl = `${baseUrl}/${path}`;
    }

    // 2. Prepare headers
    const headers = new Headers();
    if (config.headers) {
      Object.entries(config.headers).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          headers.set(key, String(val));
        }
      });
    }

    // 3. Prepare body
    const body = config.data
      ? typeof config.data === "string"
        ? config.data
        : JSON.stringify(config.data)
      : undefined;

    // 4. Execute request
    const requestInit: RequestInit = {
      method: config.method?.toUpperCase(),
      headers,
      body,
    };

    let response: Response;
    try {
      response = await tauriFetch(fullUrl, requestInit);
    } catch (error) {
      const diagnostic = buildTransportDiagnostic(error, fullUrl);
      const axiosResponse = buildSyntheticAxiosResponse(config, diagnostic.payload);
      console.error("[tauri-http] transport failed", {
        url: fullUrl,
        rawError: diagnostic.rawError,
        likelyCause: diagnostic.likelyCause,
      });
      throw buildAxiosStyleError(diagnostic.message, diagnostic.code, config, axiosResponse);
    }

    // 5. Parse response
    const responseData = await response.text();
    let parsedData = responseData;
    try {
        parsedData = JSON.parse(responseData);
    } catch {
        // Not JSON, keep as text
    }

    const axiosResponse: AxiosResponse = {
      data: parsedData,
      status: response.status,
      statusText: response.statusText,
      headers: {}, // Axios expects a specific header map format
      config,
      request: {}
    };
    
    // Map Headers to Axios format (lower case keys)
    response.headers.forEach((val, key) => {
        axiosResponse.headers[key.toLowerCase()] = val;
    });

    // Tauri plugin errors are surfaced via header even when HTTP status is 200.
    const tauriResponse = response.headers.get("Tauri-Response");
    if (tauriResponse?.toLowerCase() === "error") {
      const fallbackMessage = "Tauri HTTP plugin request failed";
      const message = resolveTauriErrorMessage(parsedData) || fallbackMessage;
      console.error("[tauri-http] request failed", {
        url: fullUrl,
        payload: parsedData,
      });
      throw buildAxiosStyleError(message, "ERR_TAURI_HTTP", config, axiosResponse);
    }

    // 6. Handle errors like Axios does (validateStatus)
    const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300);
    if (!validateStatus(response.status)) {
        throw buildAxiosStyleError(
          `Request failed with status code ${response.status}`,
          response.status.toString(),
          config,
          axiosResponse
        );
    }

    return axiosResponse;
  };
};

type TauriTransportDiagnostic = {
  code: string;
  message: string;
  rawError: string;
  likelyCause: string;
  payload: Record<string, unknown>;
};

function buildTransportDiagnostic(error: unknown, url: string): TauriTransportDiagnostic {
  const rawError = extractErrorMessage(error);
  const normalized = rawError.toLowerCase();

  const diagnostic = normalized.includes("proxy") || normalized.includes("tunnel") || normalized.includes("407")
    ? {
        code: "ERR_TAURI_HTTP_PROXY",
        likelyCause: "proxy configuration or proxy authentication issue",
      }
    : normalized.includes("certificate") ||
        normalized.includes("tls") ||
        normalized.includes("ssl") ||
        normalized.includes("handshake") ||
        normalized.includes("unknownissuer") ||
        normalized.includes("invalid peer certificate")
      ? {
          code: "ERR_TAURI_HTTP_TLS",
          likelyCause: "TLS or certificate trust issue",
        }
      : normalized.includes("dns") ||
          normalized.includes("lookup") ||
          normalized.includes("no such host") ||
          normalized.includes("name or service not known") ||
          normalized.includes("getaddrinfo")
        ? {
            code: "ERR_TAURI_HTTP_DNS",
            likelyCause: "DNS resolution issue",
          }
        : normalized.includes("timed out") || normalized.includes("timeout")
          ? {
              code: "ERR_TAURI_HTTP_TIMEOUT",
              likelyCause: "network timeout, proxy delay, or firewall delay",
            }
          : normalized.includes("connection refused") || normalized.includes("actively refused")
            ? {
                code: "ERR_TAURI_HTTP_CONNECTION_REFUSED",
                likelyCause: "target connection refused",
              }
            : normalized.includes("connection reset") ||
                normalized.includes("unexpected eof") ||
                normalized.includes("broken pipe") ||
                normalized.includes("connection closed")
              ? {
                  code: "ERR_TAURI_HTTP_CONNECTION_RESET",
                  likelyCause: "connection reset or closed during transport",
                }
              : normalized.includes("error sending request for url")
                ? {
                    code: "ERR_TAURI_HTTP_SEND_FAILED",
                    likelyCause: "request failed before any HTTP response; often proxy, TLS, DNS, or firewall related",
                  }
                : {
                    code: "ERR_TAURI_HTTP_TRANSPORT",
                    likelyCause: "desktop transport error before receiving an HTTP response",
                  };

  const message = `${rawError}. Likely cause: ${diagnostic.likelyCause}.`;

  return {
    code: diagnostic.code,
    message,
    rawError,
    likelyCause: diagnostic.likelyCause,
    payload: {
      message,
      raw_error: rawError,
      likely_cause: diagnostic.likelyCause,
      stage: "send",
      url,
    },
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  return "desktop HTTP transport failed";
}

function buildSyntheticAxiosResponse(
  config: Parameters<AxiosAdapter>[0],
  data: Record<string, unknown>
): AxiosResponse {
  return {
    data,
    status: 0,
    statusText: "",
    headers: {},
    config,
    request: {},
  };
}

function resolveTauriErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const direct = [data.message, data.error, data.details];
  for (const item of direct) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
  }
  if (data.error && typeof data.error === "object") {
    const nested = data.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim().length > 0) {
      return nested.message;
    }
  }
  return null;
}

function buildAxiosStyleError(
  message: string,
  code: string,
  config: Parameters<AxiosAdapter>[0],
  response: AxiosResponse
) {
  return {
    message,
    name: "AxiosError",
    code,
    config,
    request: {},
    response,
    isAxiosError: true,
    toJSON: () => ({}),
  };
}
