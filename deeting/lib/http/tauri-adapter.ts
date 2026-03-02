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

    const response = await tauriFetch(fullUrl, requestInit);

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
