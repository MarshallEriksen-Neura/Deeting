"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

const RELEASE_MANIFEST_ERROR =
  "Could not fetch a valid release JSON from the remote";

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const isMissingReleaseManifestError = (err: unknown) => {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  return message.includes(RELEASE_MANIFEST_ERROR);
};

interface UpdateInfo {
  version: string;
  body: string;
}

type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "update_available"
  | "unavailable"
  | "error";

export interface UseUpdateCheckerOptions {
  autoCheckOnMount?: boolean;
  initialDelayMs?: number;
}

const getErrorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "string" ? err : String(err);

export function useUpdateChecker({
  autoCheckOnMount = true,
  initialDelayMs = 5000,
}: UseUpdateCheckerOptions = {}) {
  const cachedUpdateRef = useRef<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState<UpdateCheckStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCurrentVersion = useCallback(async () => {
    if (!isTauriRuntime()) {
      setCurrentVersion(null);
      setIsLoadingVersion(false);
      return;
    }

    setIsLoadingVersion(true);
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      setCurrentVersion(await getVersion());
    } catch (err) {
      console.error("current version load failed:", err);
      setCurrentVersion(null);
    } finally {
      setIsLoadingVersion(false);
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return null;

    setIsChecking(true);
    setErrorMessage(null);
    setCheckStatus("checking");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        cachedUpdateRef.current = update;
        setUpdateInfo({
          version: update.version,
          body: update.body ?? "",
        });
        setUpdateAvailable(true);
        setCheckStatus("update_available");
        return update;
      } else {
        cachedUpdateRef.current = null;
        setUpdateInfo(null);
        setUpdateAvailable(false);
        setCheckStatus("up_to_date");
        return null;
      }
    } catch (err) {
      if (isMissingReleaseManifestError(err)) {
        cachedUpdateRef.current = null;
        setUpdateInfo(null);
        setUpdateAvailable(false);
        setCheckStatus("unavailable");
        if (process.env.NODE_ENV !== "production") {
          console.info(
            "update check skipped: updater endpoint returned no valid release manifest",
          );
        }
        return null;
      }
      console.error("update check failed:", err);
      cachedUpdateRef.current = null;
      setCheckStatus("error");
      setErrorMessage(getErrorMessage(err));
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setDownloading(true);
      setProgress(0);
      setErrorMessage(null);
      setCheckStatus("update_available");
      let update = cachedUpdateRef.current;
      if (!update) {
        update = await checkForUpdate();
      }
      if (!update) {
        setDownloading(false);
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      console.error("update install failed:", err);
      setCheckStatus("error");
      setErrorMessage(getErrorMessage(err));
      setDownloading(false);
    }
  }, [checkForUpdate]);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    void loadCurrentVersion();
  }, [loadCurrentVersion]);

  useEffect(() => {
    if (!autoCheckOnMount || !isTauriRuntime()) return;
    const timer = setTimeout(() => {
      void checkForUpdate();
    }, initialDelayMs);
    return () => clearTimeout(timer);
  }, [autoCheckOnMount, checkForUpdate, initialDelayMs]);

  return {
    currentVersion,
    isLoadingVersion,
    updateAvailable,
    updateInfo,
    downloading,
    progress,
    isChecking,
    checkStatus,
    errorMessage,
    checkForUpdate,
    installUpdate,
    dismiss,
  };
}
