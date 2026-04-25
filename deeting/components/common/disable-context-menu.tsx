"use client";

import { useEffect } from "react";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";

export function DisableContextMenu() {
  useEffect(() => {
    if (!isTauri) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  return null;
}
