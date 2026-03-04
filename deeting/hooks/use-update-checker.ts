"use client";

import { useEffect, useState, useCallback } from "react";

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

export function useUpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setUpdateInfo({
          version: update.version,
          body: update.body ?? "",
        });
        setUpdateAvailable(true);
      } else {
        setUpdateInfo(null);
        setUpdateAvailable(false);
      }
    } catch (err) {
      if (isMissingReleaseManifestError(err)) {
        setUpdateInfo(null);
        setUpdateAvailable(false);
        if (process.env.NODE_ENV !== "production") {
          console.info(
            "update check skipped: updater endpoint returned no valid release manifest",
          );
        }
        return;
      }
      console.error("update check failed:", err);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setDownloading(true);
      setProgress(0);
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;

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
      setDownloading(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    // Delay check by 5 seconds after app start
    const timer = setTimeout(checkForUpdate, 5000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return { updateAvailable, updateInfo, downloading, progress, installUpdate, dismiss };
}
