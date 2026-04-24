import { render, screen, waitFor } from "@testing-library/react";

import { ModelPoolsPageClient } from "@/components/models/model-pools-page-client";

const mockUseSWR = jest.fn();
const mockIsTauriRuntime = jest.fn();

jest.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string | number>) => {
      if (key === "labels.nodesAttached" && values) {
        return `nodes:${values.count}`;
      }
      return key;
    };
    t.raw = (key: string) => key;
    return t;
  },
  useLocale: () => "en",
}));

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));

describe("ModelPoolsPageClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the desktop-only fallback when Tauri runtime is unavailable", async () => {
    mockIsTauriRuntime.mockReturnValue(false);
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: false });

    render(<ModelPoolsPageClient />);

    await waitFor(() => {
      expect(screen.getByText("desktopOnlyTitle")).toBeInTheDocument();
    });
    expect(mockUseSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.objectContaining({ revalidateOnFocus: false }));
  });

  it("selects the first pool once local pool data loads", async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockUseSWR.mockReturnValue({
      data: [
        {
          pool_key: "pool-alpha",
          display_name: "gpt-5.4",
          provider_count: 3,
          active_provider_count: 2,
          cooling_down_count: 0,
          active_session_count: 4,
          health_score: 94,
          success_rate: 0.94,
          avg_latency_ms: 38178,
          members: [],
          bindings: [],
        },
        {
          pool_key: "pool-beta",
          display_name: "gpt-4.1",
          provider_count: 1,
          active_provider_count: 1,
          cooling_down_count: 0,
          active_session_count: 1,
          health_score: 72,
          success_rate: 0.72,
          avg_latency_ms: 18000,
          members: [],
          bindings: [],
        },
      ],
      isLoading: false,
    });

    render(<ModelPoolsPageClient />);

    await waitFor(() => {
      expect(screen.getByText("94%")).toBeInTheDocument();
    });
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(screen.getByText("38178 ms")).toBeInTheDocument();
  });
});
