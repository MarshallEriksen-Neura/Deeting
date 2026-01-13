import type { AxiosAdapter, AxiosResponse } from 'axios';

// Only load this module if we are definitely in a Tauri environment
// Webpack/Next.js dynamic imports will handle code splitting

export const createTauriAdapter = async (): Promise<AxiosAdapter> => {
  // Dynamic import to avoid breaking server-side rendering or web builds
  // where @tauri-apps/plugin-http might not be resolvable or compatible
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');

  return async (config) => {
    // 1. Build full URL
    // Axios config.url might be relative if baseURL is set, but the adapter 
    // receives the combined URL usually. However, let's ensure it's absolute for Tauri.
    // If config.baseURL is set, axios merges it before calling adapter? 
    // Actually, axios passes the full url in config.url if using baseURL, 
    // but ONLY if the adapter is the default one? 
    // Let's manually construct it to be safe if it's relative.
    
    let fullUrl = config.url || '';
    if (config.baseURL && !fullUrl.startsWith('http')) {
        // Simple join, handling slashes
        const baseUrl = config.baseURL.replace(/\/$/, '');
        const path = fullUrl.replace(/^\//, '');
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
    const body = config.data ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data)) : undefined;

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
    } catch (e) {
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

    // 6. Handle errors like Axios does (validateStatus)
    const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300);
    if (!validateStatus(response.status)) {
        throw {
            message: `Request failed with status code ${response.status}`,
            name: 'AxiosError',
            code: response.status.toString(),
            config,
            request: {},
            response: axiosResponse,
            isAxiosError: true,
            toJSON: () => ({})
        };
    }

    return axiosResponse;
  };
};
