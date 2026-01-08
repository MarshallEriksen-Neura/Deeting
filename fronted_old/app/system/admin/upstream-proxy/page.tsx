import { UpstreamProxyClient } from './components/upstream-proxy-client';

/**
 * 上游代理池管理页面（服务端组件）
 */
export default function UpstreamProxyPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <UpstreamProxyClient />
    </div>
  );
}
