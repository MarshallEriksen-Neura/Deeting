import { PerformanceDashboardClient } from './components/performance-dashboard-client';

/**
 * 系统性能监控页面 - 服务端组件
 * 
 * 注意：此页面展示的是客户端性能指标（Web Vitals），
 * 数据存储在浏览器 localStorage 中，不需要服务端预取。
 */
export default function PerformancePage() {
  return (
    <div className="space-y-8 max-w-7xl">
      <PerformanceDashboardClient />
    </div>
  );
}
