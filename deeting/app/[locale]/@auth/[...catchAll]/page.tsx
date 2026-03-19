/**
 * @auth slot catch-all 页面
 * 软导航离开 /login 时，显式清空拦截弹窗内容，避免保留旧状态。
 */
export function generateStaticParams() {
  return [{ catchAll: ["placeholder"] }]
}

export default function AuthCatchAll() {
  return null
}
