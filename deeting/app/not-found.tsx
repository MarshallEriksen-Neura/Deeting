"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// This is a standalone Root NotFound page for Deeting.
// Used when the URI doesn't match any [locale] pattern.

type DiagnosticLine = {
  id: string;
  message: string;
  timestamp: string;
};

export default function RootNotFound() {
  const [lines, setLines] = useState<DiagnosticLine[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  
  useEffect(() => {
    const diagnosticLogs = [
      "Root Kernel Observer active...",
      "Searching for spatial coordinates...",
      "ERROR: URI outside of mapped locale dimensions",
      "WARN: Attempting to recover through default gateway...",
      "RECOVERY_FAILED: Path is a void.",
    ];

    const formatTimestamp = () =>
      new Date().toLocaleTimeString([], { hour12: false });

    let i = 0;
    const interval = setInterval(() => {
      if (i < diagnosticLogs.length) {
        const message = diagnosticLogs[i];
        setLines((prev) => [
          ...prev,
          {
            id: `diag-${i}`,
            message,
            timestamp: formatTimestamp(),
          },
        ]);
        i++;
      } else {
        setIsComplete(true);
        clearInterval(interval);
      }
    }, 400);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[var(--window-bg)] p-6 font-mono text-[var(--ink)] transition-colors duration-500">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--accent-strong) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      
      <div className="relative w-full max-w-2xl px-6">
        {/* Terminal Header */}
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--danger)] opacity-50" />
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--warn)] opacity-50" />
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--ok)] opacity-50" />
          </div>
          <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--ink-4)]">
            root_panic_observer.sh
          </span>
        </div>

        {/* Log Lines */}
        <div className="min-h-[140px] space-y-1.5" aria-live="polite">
          {lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "flex gap-3 text-[11px] leading-relaxed",
                line.message.includes("ERROR")
                  ? "text-[var(--danger)]"
                  : line.message.includes("WARN")
                    ? "text-[var(--warn)]"
                    : "text-[var(--ink-3)]"
              )}
            >
              <span className="select-none opacity-40">[{line.timestamp}]</span>
              <span className="flex-1">{line.message}</span>
            </div>
          ))}
        </div>

        {/* Hero Section */}
        <div
          className={cn(
            "mt-12 transform transition-all duration-700",
            isComplete
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-4 opacity-0"
          )}
        >
          <div className="mb-2 flex items-baseline gap-4">
            <h1 className="text-7xl font-bold tracking-tighter text-[var(--ink)]">
              404
            </h1>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
          </div>
          
          <h2 className="mb-4 text-xl font-semibold text-[var(--ink-2)]">
            Dimension Mismatch
          </h2>
          
          <p className="mb-10 max-w-md text-sm leading-relaxed text-[var(--ink-3)]">
            The requested resource has drifted outside the known coordinate system.
          </p>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full bg-[var(--ink)] px-8 py-3 text-sm font-bold text-[var(--window-bg)] transition-transform hover:scale-105 active:scale-95"
            >
              REBOOT TO WORKSTATION
            </Link>
          </div>
        </div>

        {/* System Footer */}
        <div className="mt-20 flex items-center justify-between border-t border-[var(--hairline)] pt-4 text-[9px] font-medium uppercase tracking-[0.3em] text-[var(--ink-4)]">
          <span>Root Kernel Observer</span>
          <span>Status: Critical Out-of-Bounds</span>
        </div>
      </div>
    </div>
  );
}
