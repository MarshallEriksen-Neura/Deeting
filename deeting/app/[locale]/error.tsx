"use client";

import { useEffect } from "react";
import { ErrorDiagnostic } from "@/components/common/error-diagnostic";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <ErrorDiagnostic 
      code="500"
      type="error"
      error={error}
      reset={reset}
    />
  );
}
