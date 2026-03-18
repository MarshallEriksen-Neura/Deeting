"use client";

import { useEffect, useState } from "react";
import type { InstallOptions } from "@/app/page";

interface CompleteStepProps {
  options: InstallOptions;
  onOptionsChange: (options: InstallOptions) => void;
  onLaunch: () => void;
  onClose: () => void;
}

export function CompleteStep({
  options,
  onOptionsChange,
  onLaunch,
  onClose,
}: CompleteStepProps) {
  const [showCheck, setShowCheck] = useState(false);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // 延迟动画序列
    const t1 = setTimeout(() => setShowCheck(true), 200);
    const t2 = setTimeout(() => setShowContent(true), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 max-w-md w-full">
      {/* 成功动画 */}
      <div className="relative">
        {/* 扩散光环 */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(109,92,255,0.2) 0%, transparent 70%)",
            animation: showCheck ? "ring-expand 1.5s ease-out" : "none",
            width: 120,
            height: 120,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* 对勾圆环 */}
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 ${
            showCheck ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
          style={{
            background: "linear-gradient(135deg, rgba(109,92,255,0.15), rgba(33,201,195,0.1))",
            border: "2px solid rgba(109,92,255,0.3)",
            boxShadow: "0 0 40px -8px rgba(109,92,255,0.4)",
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            className="text-[var(--primary-soft)]"
          >
            <path
              d="M10 18l6 6 10-12"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 48,
                strokeDashoffset: showCheck ? 0 : 48,
                transition: "stroke-dashoffset 0.6s ease 0.3s",
              }}
            />
          </svg>
        </div>
      </div>

      {/* 文案 */}
      <div
        className={`text-center transition-all duration-500 ${
          showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        <h2 className="text-xl font-bold text-white">安装完成</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Deeting 已准备就绪，开始探索 AI Agent 的无限可能
        </p>
      </div>

      {/* 操作按钮 */}
      <div
        className={`flex flex-col items-center gap-3 w-full transition-all duration-500 delay-100 ${
          showContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        <button className="btn-primary w-full" onClick={onLaunch}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 2l10 6-10 6V2z" />
          </svg>
          启动 Deeting
        </button>

        <button
          className="text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
          onClick={onClose}
        >
          稍后启动
        </button>
      </div>
    </div>
  );
}
