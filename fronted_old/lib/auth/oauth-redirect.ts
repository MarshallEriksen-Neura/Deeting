/**
 * OAuth 重定向地址管理
 * 用于在 OAuth 登录流程中保存和恢复用户原本想访问的页面
 */

const OAUTH_REDIRECT_KEY = "oauth_redirect";

export const oauthRedirect = {
  /**
   * 保存重定向地址到 sessionStorage
   * @param url 要跳转的目标地址（默认为当前页面）
   */
  save: (url?: string) => {
    if (typeof window === "undefined") return;
    
    const redirectUrl = url || window.location.pathname + window.location.search;
    
    // 避免保存登录页和回调页本身
    if (redirectUrl.includes("/login") || redirectUrl.includes("/callback")) {
      return;
    }
    
    sessionStorage.setItem(OAUTH_REDIRECT_KEY, redirectUrl);
  },

  /**
   * 获取保存的重定向地址
   * @returns 重定向地址，如果没有则返回 null
   */
  get: (): string | null => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(OAUTH_REDIRECT_KEY);
  },

  /**
   * 清除保存的重定向地址
   */
  clear: () => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
  },

  /**
   * 获取重定向地址并清除
   * @param defaultUrl 如果没有保存的地址，返回的默认地址
   * @returns 重定向地址
   */
  getAndClear: (defaultUrl: string = "/dashboard"): string => {
    const url = oauthRedirect.get() || defaultUrl;
    oauthRedirect.clear();
    return url;
  },
};
