"use client";

import { useEffect, useState } from "react";
import { TitleBar } from "@/components/common/title-bar";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function DesktopTitlebarShell() {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    setIsTauri(isTauriRuntime());
  }, []);

  if (!isTauri) return null;

  return <TitleBar />;
}
