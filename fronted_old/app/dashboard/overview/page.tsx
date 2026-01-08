import { SWRProvider } from "@/lib/swr/provider";
import { serverFetch } from "@/lib/swr/server-fetch";
import { OverviewWrapper } from "./_components/overview-wrapper";
import type { Metadata } from "next";
import type {
  DashboardV2KPIData,
  DashboardV2PulseResponse,
  DashboardV2TokensResponse,
  DashboardV2TopModelsResponse,
  DashboardV2CostByProviderResponse,
  UserOverviewAppUsage,
} from "@/lib/api-types";

/**
 * 页面元数据
 */
export const metadata: Metadata = {
  title: "Dashboard - 概览",
  description: "查看系统健康状况、Token 使用情况和成本花费",
};

/**
 * 构建 SWR key（与客户端 useApiGet 保持一致）
 */
function buildSWRKey(endpoint: string, params: Record<string, string>): string {
  const queryString = new URLSearchParams(params).toString();
  return `${endpoint}?${queryString}`;
}

/**
 * Dashboard 用户页 - 概览页面（服务端组件）
 * 
 * 职责：
 * - 服务端预取 Dashboard 数据，避免客户端初始加载闪烁
 * - 提供页面布局和容器
 * - 通过 SWR fallback 传递预取数据给客户端
 * - 设置页面元数据
 * 
 * 验证需求：1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1
 */
export default async function DashboardOverviewPage() {
  // 默认筛选器参数（与客户端 OverviewClient 保持一致）
  const defaultFilters = {
    time_range: '7d',
    transport: 'all',
    is_stream: 'all',
  };

  const pulseFilters = {
    transport: 'all',
    is_stream: 'all',
  };

  const tokenFilters = {
    time_range: '7d',
    bucket: 'hour',
    transport: 'all',
    is_stream: 'all',
  };

  const topModelsFilters = {
    time_range: '7d',
    limit: '10',
    transport: 'all',
    is_stream: 'all',
  };

  const costFilters = {
    time_range: '7d',
    limit: '12',
  };

  const appsFilters = {
    time_range: '7d',
    limit: '10',
  };

  // 构建 API 端点和 SWR keys
  const kpisKey = buildSWRKey('/metrics/user-dashboard/kpis', defaultFilters);
  const pulseKey = buildSWRKey('/metrics/user-dashboard/pulse', pulseFilters);
  const tokensKey = buildSWRKey('/metrics/user-dashboard/tokens', tokenFilters);
  const topModelsKey = buildSWRKey('/metrics/user-dashboard/top-models', topModelsFilters);
  const costKey = buildSWRKey('/metrics/user-dashboard/cost-by-provider', costFilters);
  const appsKey = buildSWRKey('/metrics/user-overview/apps', appsFilters);

  // 并行预取所有 Dashboard 数据
  const [kpisData, pulseData, tokensData, topModelsData, costData, appsData] = await Promise.all([
    serverFetch<DashboardV2KPIData>(kpisKey),
    serverFetch<DashboardV2PulseResponse>(pulseKey),
    serverFetch<DashboardV2TokensResponse>(tokensKey),
    serverFetch<DashboardV2TopModelsResponse>(topModelsKey),
    serverFetch<DashboardV2CostByProviderResponse>(costKey),
    serverFetch<UserOverviewAppUsage>(appsKey),
  ]);

  return (
    <SWRProvider
      fallback={{
        [kpisKey]: kpisData,
        [pulseKey]: pulseData,
        [tokensKey]: tokensData,
        [topModelsKey]: topModelsData,
        [costKey]: costData,
        [appsKey]: appsData,
      }}
    >
      <div className="container mx-auto p-6">
        <OverviewWrapper />
      </div>
    </SWRProvider>
  );
}
