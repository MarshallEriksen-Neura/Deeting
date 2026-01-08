import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProviderRankingCard } from "../provider-ranking-card";
import { I18nProvider } from "@/lib/i18n-context";
import * as useUserOverviewModule from "@/lib/swr/use-user-overview-metrics";

vi.mock("@/lib/swr/use-user-overview-metrics");

const mockUseUserOverviewProviders = useUserOverviewModule.useUserOverviewProviders as unknown as vi.Mock;

function renderWithI18n(component: React.ReactElement) {
  return render(<I18nProvider>{component}</I18nProvider>);
}

describe("ProviderRankingCard Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("根据时间范围向 SWR Hook 传递正确参数", async () => {
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

    const { rerender } = renderWithI18n(<ProviderRankingCard timeRange="today" />);

    await waitFor(() => {
      expect(mockUseUserOverviewProviders).toHaveBeenCalledWith({
        time_range: "today",
        limit: 5,
      });
    });

    rerender(
      <I18nProvider>
        <ProviderRankingCard timeRange="30d" />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(mockUseUserOverviewProviders).toHaveBeenLastCalledWith({
        time_range: "30d",
        limit: 5,
      });
    });
  });

  it("当返回数据时展示行内容", async () => {
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
            total_requests: 123,
            success_requests: 120,
            error_requests: 3,
            success_rate: 0.975,
            latency_p95_ms: 88,
          },
        ],
      },
      loading: false,
      error: null,
      validating: false,
      refresh: vi.fn(),
    });

    renderWithI18n(<ProviderRankingCard timeRange="7d" />);

    expect(await screen.findByText("openai")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
  });
});
