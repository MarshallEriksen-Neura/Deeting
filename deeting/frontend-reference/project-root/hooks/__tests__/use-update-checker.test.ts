import { act, renderHook, waitFor } from "@testing-library/react";

import { useUpdateChecker } from "../use-update-checker";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

jest.mock("@tauri-apps/plugin-updater", () => ({
  check: jest.fn(),
}));

jest.mock("@tauri-apps/api/app", () => ({
  getVersion: jest.fn(),
}));

const mockedCheck = check as jest.MockedFunction<typeof check>;
const mockedGetVersion = getVersion as jest.MockedFunction<typeof getVersion>;
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI;
const windowWithTauri = window as Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

describe("useUpdateChecker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NEXT_PUBLIC_IS_TAURI = "true";
    windowWithTauri.__TAURI__ = {};
    mockedCheck.mockReset();
    mockedGetVersion.mockReset();
    mockedGetVersion.mockResolvedValue("0.1.0-6");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag;
    delete windowWithTauri.__TAURI__;
    delete windowWithTauri.__TAURI_INTERNALS__;
    jest.restoreAllMocks();
  });

  it("silences expected release manifest errors", async () => {
    mockedCheck.mockRejectedValueOnce(
      new Error("Could not fetch a valid release JSON from the remote"),
    );

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);

    const { result } = renderHook(() => useUpdateChecker());

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(mockedCheck).toHaveBeenCalledTimes(1);
    });

    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.updateInfo).toBeNull();
    expect(result.current.checkStatus).toBe("unavailable");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      "update check skipped: updater endpoint returned no valid release manifest",
    );
  });

  it("stores update info when update is available", async () => {
    mockedCheck.mockResolvedValueOnce({
      version: "1.2.3",
      body: "bug fixes",
    } as never);

    const { result } = renderHook(() => useUpdateChecker());

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    expect(result.current.updateInfo).toEqual({
      version: "1.2.3",
      body: "bug fixes",
    });
    expect(result.current.checkStatus).toBe("update_available");
  });

  it("loads the current desktop version", async () => {
    const { result } = renderHook(() => useUpdateChecker({ autoCheckOnMount: false }));

    await waitFor(() => {
      expect(result.current.isLoadingVersion).toBe(false);
    });

    expect(mockedGetVersion).toHaveBeenCalledTimes(1);
    expect(result.current.currentVersion).toBe("0.1.0-6");
  });

  it("supports manual update checks without the delayed auto-check", async () => {
    mockedCheck.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useUpdateChecker({ autoCheckOnMount: false }));

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockedCheck).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(result.current.checkStatus).toBe("up_to_date");
  });

  it("skips update check when tauri runtime marker is missing", () => {
    delete windowWithTauri.__TAURI__;
    delete windowWithTauri.__TAURI_INTERNALS__;

    renderHook(() => useUpdateChecker());

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockedCheck).not.toHaveBeenCalled();
    expect(mockedGetVersion).not.toHaveBeenCalled();
  });
});
