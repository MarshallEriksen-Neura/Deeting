"use client";

import { useEffect, useState, useCallback } from "react";
import { usePlatform } from "@/lib/platform/provider";

const STORAGE_KEY = "deeting-close-action";
const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";

type CloseAction = "minimize" | "quit";

export function useCloseHandler() {
  const [showDialog, setShowDialog] = useState(false);
  const { app } = usePlatform();

  const executeAction = useCallback(async (action: CloseAction) => {
    if (!isTauri || typeof window === "undefined") return;
    try {
      if (action === "minimize") {
        await app.minimize();
      } else {
        await app.quit();
      }
    } catch (err) {
      console.error("close action failed:", err);
    }
  }, [app]);

  const handleChoose = useCallback(
    (action: CloseAction, remember: boolean) => {
      setShowDialog(false);
      if (remember) {
        localStorage.setItem(STORAGE_KEY, action);
      }
      executeAction(action);
    },
    [executeAction]
  );

  useEffect(() => {
    if (!isTauri || typeof window === "undefined") return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("close-requested", () => {
        const saved = localStorage.getItem(STORAGE_KEY) as CloseAction | null;
        if (saved) {
          executeAction(saved);
        } else {
          setShowDialog(true);
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [executeAction]);

  return { showDialog, handleChoose };
}
