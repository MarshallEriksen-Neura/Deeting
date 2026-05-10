"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "deeting:advancedMode";

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function useAdvancedMode() {
  const isAdvancedMode = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const toggleAdvancedMode = useCallback(() => {
    const next = !isAdvancedMode;
    localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    // Dispatch a custom event so other hooks/contexts in the same tab react
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, [isAdvancedMode]);

  const setAdvancedMode = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return { isAdvancedMode, toggleAdvancedMode, setAdvancedMode };
}
