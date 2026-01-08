import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { swrKeys } from "../keys";
import { providerSubmissionService } from "@/http/provider-submission";

const { mutateMock, useApiGetMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  useApiGetMock: vi.fn(),
}));

vi.mock("swr", async () => {
  const actual = await vi.importActual<any>("swr");
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mutateMock }),
  };
});

vi.mock("../hooks", () => ({
  useApiGet: useApiGetMock,
}));

vi.mock("@/http/provider-submission", () => ({
  providerSubmissionService: {
    cancelSubmission: vi.fn(),
  },
}));

import { useCancelProviderSubmission, useMyProviderSubmissions } from "../use-provider-submissions";

const wrapper = ({ children }: { children: React.ReactNode }) => children;

describe("use-provider-submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiGetMock.mockReturnValue({
      data: [],
      error: null,
      loading: false,
      refresh: vi.fn(),
    });
  });

  it("useMyProviderSubmissions should delegate to useApiGet with stable key", () => {
    renderHook(() => useMyProviderSubmissions(), { wrapper });
    expect(useApiGetMock).toHaveBeenCalledWith(swrKeys.providerSubmissionsMe(), {
      strategy: "frequent",
    });
  });

  it("useMyProviderSubmissions should be disable-able", () => {
    renderHook(() => useMyProviderSubmissions(false), { wrapper });
    expect(useApiGetMock).toHaveBeenCalledWith(null, { strategy: "frequent" });
  });

  it("useCancelProviderSubmission should cancel and invalidate cache", async () => {
    vi.mocked(providerSubmissionService.cancelSubmission).mockResolvedValue(undefined);

    const { result } = renderHook(() => useCancelProviderSubmission(), { wrapper });
    await result.current("s1");

    expect(providerSubmissionService.cancelSubmission).toHaveBeenCalledWith("s1");
    expect(mutateMock).toHaveBeenCalledWith(swrKeys.providerSubmissionsMe());
  });
});
