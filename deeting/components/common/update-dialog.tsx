"use client";

import { useMemo } from "react";
import {
  AlertDialog,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface UpdateDialogProps {
  open: boolean;
  version: string;
  body: string;
  downloading: boolean;
  progress: number;
  onInstall: () => void;
  onDismiss: () => void;
}

/** 将 changelog body 按分类解析成结构化数据 */
function parseChangelog(body: string) {
  if (!body.trim()) return null;

  const sections: { icon: string; label: string; items: string[] }[] = [];
  let currentItems: string[] = [];
  let currentIcon = "sparkle";
  let currentLabel = "更新内容";

  const sectionMap: Record<string, { icon: string; label: string }> = {
    feature: { icon: "sparkle", label: "新功能" },
    feat: { icon: "sparkle", label: "新功能" },
    fix: { icon: "wrench", label: "修复" },
    bug: { icon: "wrench", label: "修复" },
    perf: { icon: "zap", label: "性能优化" },
    improvement: { icon: "zap", label: "改进" },
    breaking: { icon: "alert", label: "重要变更" },
  };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    // 检测 markdown 标题 (## Features, ### Bug Fixes, etc.)
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentItems.length > 0) {
        sections.push({ icon: currentIcon, label: currentLabel, items: [...currentItems] });
        currentItems = [];
      }
      const heading = headingMatch[1].toLowerCase();
      const matched = Object.entries(sectionMap).find(([key]) => heading.includes(key));
      if (matched) {
        currentIcon = matched[1].icon;
        currentLabel = matched[1].label;
      } else {
        currentIcon = "sparkle";
        currentLabel = headingMatch[1];
      }
      continue;
    }

    // 检测列表项 (- item, * item)
    const itemMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (itemMatch) {
      currentItems.push(itemMatch[1]);
    } else if (trimmed && !trimmed.startsWith("#")) {
      currentItems.push(trimmed);
    }
  }

  if (currentItems.length > 0) {
    sections.push({ icon: currentIcon, label: currentLabel, items: currentItems });
  }

  return sections.length > 0 ? sections : null;
}

const SectionIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "sparkle":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M3.5 12.5l2-2M10.5 5.5l2-2" />
        </svg>
      );
    case "wrench":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2a3.5 3.5 0 00-3 5.2L3 11.2l1.8 1.8 4-4A3.5 3.5 0 0010 2z" />
        </svg>
      );
    case "zap":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 1L4 9h4l-1 6 5-8H8l1-6z" />
        </svg>
      );
    case "alert":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1L1 14h14L8 1zM8 6v4M8 12h.01" />
        </svg>
      );
    default:
      return null;
  }
};

export function UpdateDialog({
  open,
  version,
  body,
  downloading,
  progress,
  onInstall,
  onDismiss,
}: UpdateDialogProps) {
  const changelog = useMemo(() => parseChangelog(body), [body]);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className={cn(
          "max-w-md p-0 gap-0 border-0 overflow-hidden",
          "bg-[var(--surface)]/95 backdrop-blur-2xl",
          "border border-white/[0.06]",
          "shadow-[0_24px_80px_-12px_rgba(109,92,255,0.15),0_8px_24px_-8px_rgba(0,0,0,0.4)]",
        )}
      >
        {/* ── 顶部视觉区域 ────────────────────────── */}
        <div className="relative px-6 pt-6 pb-4 overflow-hidden">
          {/* 背景光晕 */}
          <div
            className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(109,92,255,0.12) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute -top-8 -left-8 w-32 h-32 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(33,201,195,0.08) 0%, transparent 70%)",
            }}
          />

          {/* 版本标签 + 标题 */}
          <div className="relative flex items-start gap-3">
            {/* 更新图标 */}
            <div
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(109,92,255,0.15), rgba(94,200,255,0.1))",
                border: "1px solid rgba(109,92,255,0.2)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="text-[var(--primary-soft,#a6b0ff)]"
              >
                <path
                  d="M10 3v8M6 7l4-4 4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 13v2a2 2 0 002 2h10a2 2 0 002-2v-2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  发现新版本
                </h2>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-medium"
                  style={{
                    background: "linear-gradient(135deg, rgba(109,92,255,0.15), rgba(94,200,255,0.1))",
                    color: "var(--primary-soft, #a6b0ff)",
                    border: "1px solid rgba(109,92,255,0.15)",
                  }}
                >
                  v{version}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Deeting 有新版本可用
              </p>
            </div>
          </div>
        </div>

        {/* ── Changelog 区域 ──────────────────────── */}
        {changelog && (
          <div className="px-6 pb-3">
            <div
              className="max-h-48 overflow-y-auto rounded-lg p-3 space-y-3"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              {changelog.map((section, si) => (
                <div key={si}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[var(--primary-soft,#a6b0ff)]">
                      <SectionIcon type={section.icon} />
                    </span>
                    <span className="text-xs font-medium text-foreground/80">
                      {section.label}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-5">
                    {section.items.slice(0, 5).map((item, ii) => (
                      <li
                        key={ii}
                        className="text-xs text-muted-foreground leading-relaxed list-disc"
                      >
                        {item}
                      </li>
                    ))}
                    {section.items.length > 5 && (
                      <li className="text-xs text-muted-foreground/60">
                        +{section.items.length - 5} 更多...
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 无 changelog 时的 fallback */}
        {!changelog && body && (
          <div className="px-6 pb-3">
            <div
              className="max-h-40 overflow-y-auto rounded-lg p-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              {body}
            </div>
          </div>
        )}

        {/* ── 下载进度 ───────────────────────────── */}
        {downloading && (
          <div className="px-6 pb-3">
            <div className="space-y-2">
              {/* 进度条 */}
              <div className="w-full h-1.5 rounded-full overflow-hidden bg-white/[0.04]">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out relative"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #8b7bff, #5ec8ff, #a6e1ff)",
                  }}
                >
                  {/* shimmer 流光 */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 2s infinite",
                    }}
                  />
                </div>
              </div>

              {/* 进度文字 */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {progress < 100 ? "正在下载更新..." : "准备安装..."}
                </span>
                <span className="text-xs font-mono text-[var(--primary-soft,#a6b0ff)]">
                  {progress}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── 操作按钮 ───────────────────────────── */}
        <div
          className="flex items-center justify-end gap-2 px-6 py-4"
          style={{
            background: "rgba(255,255,255,0.015)",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <button
            onClick={onDismiss}
            disabled={downloading}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-white/[0.04]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            稍后提醒
          </button>
          <button
            onClick={onInstall}
            disabled={downloading}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              !downloading && "hover:-translate-y-px",
            )}
            style={{
              background: downloading
                ? "rgba(109,92,255,0.3)"
                : "linear-gradient(135deg, #8b7bff 0%, #5ec8ff 55%, #a6e1ff 100%)",
              boxShadow: downloading
                ? "none"
                : "0 4px 16px -4px rgba(109,92,255,0.35)",
            }}
          >
            {downloading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                  <path d="M7 1a6 6 0 015.2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                更新中...
              </span>
            ) : (
              "立即更新"
            )}
          </button>
        </div>

        {/* shimmer 动画 keyframes */}
        <style>{`
          @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
        `}</style>
      </AlertDialogContent>
    </AlertDialog>
  );
}
