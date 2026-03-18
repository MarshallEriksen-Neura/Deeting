"use client";

import { useState, useEffect } from "react";
import { Logo } from "@/components/logo";

interface InstallingStepProps {
  progress: number;
  message: string;
}

const FEATURES = [
  {
    icon: "chat",
    title: "智能会议助手",
    desc: "AI 实时转写、智能摘要、行动项提取",
  },
  {
    icon: "plugin",
    title: "MCP 插件生态",
    desc: "一键安装丰富插件，无限扩展 Agent 能力",
  },
  {
    icon: "agents",
    title: "多 Agent 协作",
    desc: "专业 Agent 团队，协同完成复杂任务",
  },
  {
    icon: "insight",
    title: "会议洞察分析",
    desc: "数据驱动决策，深度理解团队沟通模式",
  },
];

const FeatureIcon = ({ type }: { type: string }) => {
  const icons: Record<string, React.ReactNode> = {
    chat: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </svg>
    ),
    plugin: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    agents: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21a8 8 0 10-16 0" />
        <circle cx="19" cy="8" r="2.5" opacity="0.5" />
        <circle cx="5" cy="8" r="2.5" opacity="0.5" />
      </svg>
    ),
    insight: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-6 4 3 5-7" />
      </svg>
    ),
  };
  return <>{icons[type]}</>;
};

export function InstallingStep({ progress, message }: InstallingStepProps) {
  const [activeFeature, setActiveFeature] = useState(0);

  // 自动轮播功能特性
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % FEATURES.length);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-lg animate-fade-in">
      {/* 上半部分: Logo + 功能展示 */}
      <div className="flex items-center gap-8 w-full">
        {/* 左侧 Logo */}
        <div className="flex-shrink-0">
          <Logo size={64} spinning />
        </div>

        {/* 右侧功能轮播 */}
        <div className="flex-1 min-h-[100px]">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.icon}
              className={`transition-all duration-500 ${
                i === activeFeature
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-2 absolute pointer-events-none"
              }`}
              style={{ display: i === activeFeature ? "block" : "none" }}
            >
              <div className="glass p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)]/20 to-[var(--teal)]/10 flex items-center justify-center text-[var(--primary-soft)]">
                  <FeatureIcon type={feature.icon} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* 轮播指示器 */}
          <div className="flex gap-1.5 mt-3">
            {FEATURES.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === activeFeature
                    ? "w-5 bg-[var(--primary)]"
                    : "w-1.5 bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 下半部分: 进度 */}
      <div className="w-full space-y-3">
        {/* 进度条 */}
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 进度信息 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{message}</span>
          <span className="text-xs font-mono text-[var(--primary-soft)]">
            {progress}%
          </span>
        </div>
      </div>
    </div>
  );
}
