import { act, renderHook, waitFor } from "@testing-library/react";

import { useUpdateChecker } from "../use-update-checker";
import { check } from "@tauri-apps/plugin-updater";

jest.mock("@tauri-apps/plugin-updater", () => ({
  check: jest.fn(),
}));

const mockedCheck = check as jest.MockedFunction<typeof check>;
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
  });

  it("skips update check when tauri runtime marker is missing", () => {
    delete windowWithTauri.__TAURI__;
    delete windowWithTauri.__TAURI_INTERNALS__;

    renderHook(() => useUpdateChecker());

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockedCheck).not.toHaveBeenCalled();
  });
});
