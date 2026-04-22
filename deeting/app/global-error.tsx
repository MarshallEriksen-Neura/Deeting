"use client";

import React, { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

// Note: GlobalError cannot use i18n components safely if the layout failed.
// We provide a self-contained version of the diagnostic UI.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  
  const traceId = useMemo(() => 
    error?.digest || Math.random().toString(36).substring(2, 15).toUpperCase(), 
  [error]);

  useEffect(() => {
    const diagnosticLogs = [
      "CRITICAL SYSTEM FAILURE DETECTED",
      "Analyzing kernel memory dumps...",
      `ERROR_TYPE: ${error?.name || 'UnknownError'}`,
      `FATAL_DIGEST: ${traceId}`,
      "Attempting to isolate the ripple effect...",
      "Safe mode available. Manual reset required.",
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < diagnosticLogs.length) {
        setLines((prev) => [...prev, diagnosticLogs[i]]);
        i++;
      } else {
        setIsComplete(true);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [error, traceId]);

  return (
    <html lang="en">
      <body className="bg-[var(--window-bg)] text-[var(--ink)] font-mono m-0 p-0 overflow-hidden transition-colors duration-500">
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <div className="absolute inset-0 opacity-[0.03]" 
               style={{ backgroundImage: 'radial-gradient(circle, var(--danger) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
          
          <div className="relative w-full max-w-2xl">
            {/* Terminal Header */}
            <div className="flex items-center gap-2 mb-8 border-b border-[var(--hairline)] pb-4">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--danger)]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--danger)] opacity-30" />
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--danger)] opacity-30" />
              </div>
              <span className="text-[10px] text-[var(--danger)] uppercase tracking-widest font-bold ml-2">
                deeting_kernel_panic
              </span>
            </div>

            {/* Log Lines */}
            <div className="space-y-2 min-h-[160px]">
              {lines.map((line, idx) => (
                <div key={idx} className="text-xs leading-relaxed flex gap-4 text-[var(--danger)] opacity-80">
                  <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>

            {/* Content */}
            <div className={cn(
              "mt-16 transition-all duration-1000",
              isComplete ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            )}>
              <h1 className="text-8xl font-black mb-4 tracking-tighter text-[var(--ink)]">FATAL</h1>
              <p className="text-[var(--ink-3)] mb-12 max-w-md leading-relaxed">
                The workstation encountered a critical error that prevented it from starting normally. 
                System state has been frozen for safety.
              </p>
              
              <button 
                onClick={() => reset()}
                className="px-10 py-4 bg-[var(--ink)] text-[var(--window-bg)] font-bold rounded-full hover:scale-105 transition-transform active:scale-95 shadow-xl"
              >
                REBOOT CORE SYSTEM
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
