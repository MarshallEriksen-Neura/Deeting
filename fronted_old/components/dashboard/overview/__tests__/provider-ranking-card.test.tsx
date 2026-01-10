import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderRankingCard } from "../provider-ranking-card";
import { I18nProvider } from "@/lib/i18n-context";
import * as useUserOverviewModule from "@/lib/swr/use-user-overview-metrics";
import { useRouter } from "next/navigation";

vi.mock("@/lib/swr/use-user-overview-metrics");
vi.mock("next/navigation");

const mockUseUserOverviewProviders = useUserOverviewModule.useUserOverviewProviders as unknown as vi.Mock;
const mockUseRouter = useRouter as unknown as vi.Mock;

function renderWithI18n(component: React.ReactElement) {
  return render(<I18nProvider>{component}</I18nProvider>);
}

describe("ProviderRankingCard - 用户维度排行", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue({
      push: vi.fn(),
    });
  });

  it("按请求量排序 Provider 并展示请求数", async () => {
    mockUseUserOverviewProviders.mockReturnValue({
      providers: {
        scope: "user",
        user_id: "tester",
        time_range: "7d",
        transport: "all",
        is_stream: "all",
        items: [
          {
            provider_id: "openai",
            total_requests: 200,
            success_requests: 190,
            error_requests: 10,
            success_rate: 0.95,
            latency_p95_ms: 120,
          },
          {
            provider_id: "claude",
            total_requests: 100,
            success_requests: 70,
            error_requests: 30,
            success_rate: 0.7,
            latency_p95_ms: 80,
          },
        ],
      },
      loading: false,
      error: null,
      validating: false,
      refresh: vi.fn(),
    });

    renderWithI18n(<ProviderRankingCard timeRange="7d" />);

    const rows = await screen.findAllByTestId(/provider-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("openai");
    expect(rows[0]).toHaveTextContent("200");
    expect(rows[1]).toHaveTextContent("claude");
    expect(rows[1]).toHaveTextContent("100");
  });

  it("展示成功率和延迟信息", async () => {
    mockUseUserOverviewProviders.mockReturnValue({
      providers: {
        scope: "user",
        user_id: "tester",
        time_range: "7d",
        transport: "all",
        is_stream: "all",
        items: [
          {
            provider_id: "openai",
            total_requests: 50,
            success_requests: 25,
            error_requests: 25,
            success_rate: 0.5,
            latency_p95_ms: null,
          },
        ],
      },
      loading: false,
      error: null,
      validating: false,
      refresh: vi.fn(),
    });

    renderWithI18n(<ProviderRankingCard timeRange="7d" />);

    expect(await screen.findByText("50")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("显示空数据状态", async () => {
    mockUseUserOverviewProviders.mockReturnValue({
      providers: {
        scope: "user",
        user_id: "tester",
        time_range: "7d",
        transport: "all",
        is_stream: "all",
        items: [],
      },
      loading: false,
      error: null,
      validating: false,
      refresh: vi.fn(),
    });

    renderWithI18n(<ProviderRankingCard timeRange="7d" />);
    expect(await screen.findByText("No provider data available")).toBeInTheDocument();
  });

  it("点击行时跳转到 Provider 详情", async () => {
    const push = vi.fn();
    mockUseRouter.mockReturnValue({ push });
    mockUseUserOverviewProviders.mockReturnValue({
      providers: {
        scope: "user",
        user_id: "tester",
        time_range: "7d",
        transport: "all",
        is_stream: "all",
        items: [
          {
            provider_id: "openai",
            total_requests: 10,
            success_requests: 9,
            error_requests: 1,
            success_rate: 0.9,
            latency_p95_ms: 100,
          },
        ],
      },
      loading: false,
      error: null,
      validating: false,
      refresh: vi.fn(),
    });

    renderWithI18n(<ProviderRankingCard timeRange="7d" />);

    const row = await screen.findByTestId("provider-row-openai");
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith("/dashboard/providers/openai");
  });
});
