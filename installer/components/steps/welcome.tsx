"use client";

import { useState } from "react";
import type { InstallOptions } from "@/app/page";
import { Logo } from "@/components/logo";

interface WelcomeStepProps {
  options: InstallOptions;
  onOptionsChange: (options: InstallOptions) => void;
  onInstall: () => void;
}

export function WelcomeStep({ options, onOptionsChange, onInstall }: WelcomeStepProps) {
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="flex flex-col items-center gap-6 animate-fade-in max-w-md w-full">
      {/* Logo + 品牌 */}
      <div className="flex flex-col items-center gap-4">
        <Logo size={88} />
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Deeting
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Your AI Agent Workspace
          </p>
        </div>
      </div>

      {/* 自定义安装面板 */}
      {showCustom && (
        <div className="w-full glass p-4 space-y-3 animate-fade-in">
          {/* 安装路径 */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              安装位置
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={options.installPath}
                onChange={(e) =>
                  onOptionsChange({ ...options, installPath: e.target.value })
                }
                className="flex-1 h-9 px-3 rounded-lg bg-white/5 border border-white/8 text-sm text-white outline-none focus:border-[var(--primary)]/40 transition-colors"
              />
              <button
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/8 text-sm text-[var(--text-muted)] hover:bg-white/8 transition-colors"
                onClick={async () => {
                  try {
                    // 在 Tauri 中打开文件夹选择对话框
                    // const { open } = await import("@tauri-apps/plugin-dialog");
                    // const path = await open({ directory: true });
                    // if (path) onOptionsChange({ ...options, installPath: path as string });
                  } catch {}
                }}
              >
                浏览
              </button>
            </div>
          </div>

          {/* 选项 */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative w-4 h-4">
                <input
                  type="checkbox"
                  checked={options.createShortcut}
                  onChange={(e) =>
                    onOptionsChange({ ...options, createShortcut: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="w-4 h-4 rounded border border-white/20 peer-checked:bg-[var(--primary)] peer-checked:border-[var(--primary)] transition-all flex items-center justify-center">
                  {options.createShortcut && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4l3 3 5-6" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-[var(--text-muted)] group-hover:text-white transition-colors">
                创建桌面快捷方式
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative w-4 h-4">
                <input
                  type="checkbox"
                  checked={options.autoStart}
                  onChange={(e) =>
                    onOptionsChange({ ...options, autoStart: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="w-4 h-4 rounded border border-white/20 peer-checked:bg-[var(--primary)] peer-checked:border-[var(--primary)] transition-all flex items-center justify-center">
                  {options.autoStart && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4l3 3 5-6" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-[var(--text-muted)] group-hover:text-white transition-colors">
                开机自动启动
              </span>
            </label>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-col items-center gap-3 w-full">
        <button className="btn-primary w-full" onClick={onInstall}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 14h12M8 2v9M4 7l4 4 4-4" />
          </svg>
          极速安装
        </button>

        <button
          className="text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
          onClick={() => setShowCustom(!showCustom)}
        >
          {showCustom ? "收起选项" : "自定义安装"}
        </button>
      </div>

      {/* 协议 */}
      <p className="text-[11px] text-[var(--text-muted)]/60 text-center leading-relaxed">
        点击安装即表示同意{" "}
        <span className="text-[var(--primary-soft)] cursor-pointer hover:underline">
          用户协议
        </span>{" "}
        和{" "}
        <span className="text-[var(--primary-soft)] cursor-pointer hover:underline">
          隐私政策
        </span>
      </p>
    </div>
  );
}
