"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/shadcn/button";
import { cn } from "@/lib/utils";

interface ErrorDiagnosticProps {
  code?: string | number;
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
  type?: "404" | "error";
}

export function ErrorDiagnostic({
  code = "404",
  title,
  description,
  error,
  reset,
  type = "404",
}: ErrorDiagnosticProps) {
  const t = useTranslations("common");
  const [lines, setLines] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  
  const traceId = useMemo(() => 
    error?.digest || Math.random().toString(36).substring(2, 15).toUpperCase(), 
  [error]);

  useEffect(() => {
    const diagnosticLogs = [
      "Initializing Deeting Workstation Diagnostic...",
      "Verifying core system integrity...",
      type === "404" 
        ? "WARN: Dimension mismatch detected at current URI path"
        : `CRITICAL: Unhandled exception in main thread [${error?.name || 'UnknownError'}]`,
      type === "404"
        ? "ERROR: Target resource evaporated or never existed"
        : `ERROR: System ripple exceeded safety thresholds`,
      `Diagnostic finished. ID: DT-${traceId}`,
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
    }, 450);

    return () => clearInterval(interval);
  }, [type, error, traceId]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--window-bg)] font-mono overflow-hidden transition-colors duration-500">
      {/* Background Grid */}
      <div 
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.03] pointer-events-none" 
        style={{ 
          backgroundImage: 'radial-gradient(circle, var(--accent-strong) 1px, transparent 1px)', 
          backgroundSize: '32px 32px' 
        }} 
      />
      
      <div className="relative w-full max-w-2xl px-6">
        {/* Terminal Header */}
        <div className="flex items-center gap-2 mb-4 border-b border-[var(--hairline)] pb-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--danger)] opacity-50" />
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--warn)] opacity-50" />
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--ok)] opacity-50" />
          </div>
          <span className="text-[10px] text-[var(--ink-4)] uppercase tracking-widest ml-2">
            deeting_kernel_observer.sh
          </span>
        </div>

        {/* Log Lines */}
        <div className="space-y-1.5 min-h-[140px]">
          {lines.map((line, idx) => (
            <div 
              key={idx} 
              className={cn(
                "text-[11px] leading-relaxed flex gap-3",
                line.includes('ERROR') || line.includes('CRITICAL') ? 'text-[var(--danger)]' : 
                line.includes('WARN') ? 'text-[var(--warn)]' : 'text-[var(--ink-3)]'
              )}
            >
              <span className="opacity-40 select-none">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
              <span className="flex-1">{line}</span>
            </div>
          ))}
        </div>

        {/* Hero Section */}
        <div className={cn(
          "mt-12 transition-all duration-700 transform",
          isComplete ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}>
          <div className="flex items-baseline gap-4 mb-2">
            <h1 className="text-7xl font-bold text-[var(--ink)] tracking-tighter">
              {code}
            </h1>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
          </div>
          
          <h2 className="text-xl font-semibold text-[var(--ink-2)] mb-4">
            {type === "404" ? (title || t("notFound.title")) : (title || t("globalError.title"))}
          </h2>
          
          <p className="text-sm text-[var(--ink-3)] leading-relaxed mb-10 max-w-md">
            {type === "404" ? (description || t("notFound.description")) : (description || t("globalError.description"))}
          </p>

          <div className="flex items-center gap-3">
            {type === "error" && reset && (
              <Button 
                variant="ios-primary" 
                size="lg"
                onClick={() => reset()}
              >
                {t("globalError.primary")}
              </Button>
            )}
            
            <Button 
              variant={type === "error" ? "outline" : "ios-primary"}
              size="lg"
              asChild
            >
              <Link href="/">
                {type === "404" ? t("notFound.backHome") : t("globalError.secondary")}
              </Link>
            </Button>
          </div>
        </div>

        {/* System Footer */}
        <div className="mt-20 flex justify-between items-center text-[9px] text-[var(--ink-4)] uppercase tracking-[0.3em] font-medium border-t border-[var(--hairline)] pt-4">
          <span>Observed by Deeting Kernel</span>
          <span>Access: Root / S-Level</span>
        </div>
      </div>

      {/* Noise Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015] dark:opacity-[0.02] mix-blend-overlay">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise)" />
        </svg>
      </div>
    </div>
  );
}
