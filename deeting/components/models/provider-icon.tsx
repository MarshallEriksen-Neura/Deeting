"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface ProviderIconProps {
  src?: string | null;
  alt?: string;
  className?: string;
  fallback: React.ReactNode;
}

export function ProviderIcon({ src, alt = "", className, fallback }: ProviderIconProps) {
  const [failed, setFailed] = React.useState(false);
  const usableSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;

  React.useEffect(() => {
    setFailed(false);
  }, [usableSrc]);

  if (!usableSrc || failed) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={usableSrc}
      alt={alt}
      className={cn("object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}
