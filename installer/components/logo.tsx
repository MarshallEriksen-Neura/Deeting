"use client";

interface LogoProps {
  size?: number;
  spinning?: boolean;
}

export function Logo({ size = 80, spinning = false }: LogoProps) {
  const r = size / 2;

  return (
    <div
      className={`relative ${spinning ? "" : "animate-logo-glow"}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={spinning ? { animation: "spin 8s linear infinite" } : undefined}
      >
        {/* 外环 */}
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke="url(#outerRing)"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* 内环 */}
        <circle
          cx="50"
          cy="50"
          r="36"
          stroke="url(#innerRing)"
          strokeWidth="2"
          opacity="0.4"
        />

        {/* 金色弧线 */}
        <path
          d="M 42 28 Q 38 50 50 72"
          stroke="url(#goldArc)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />

        {/* 紫色弧线 */}
        <path
          d="M 58 22 Q 72 40 65 68"
          stroke="url(#purpleArc)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />

        {/* 中心青色节点 */}
        <circle cx="48" cy="50" r="3.5" fill="#21c9c3">
          <animate
            attributeName="r"
            values="3;4;3"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.8;1;0.8"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>

        {/* 节点光晕 */}
        <circle cx="48" cy="50" r="6" fill="#21c9c3" opacity="0.15">
          <animate
            attributeName="r"
            values="6;10;6"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.15;0.05;0.15"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="outerRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6d5cff" />
            <stop offset="50%" stopColor="#8b7bff" />
            <stop offset="100%" stopColor="#5c4ed9" />
          </linearGradient>

          <linearGradient id="innerRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a6b0ff" />
            <stop offset="100%" stopColor="#8b7bff" />
          </linearGradient>

          <linearGradient id="goldArc" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#d4a853" />
            <stop offset="100%" stopColor="#c49a45" />
          </linearGradient>

          <linearGradient id="purpleArc" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b7bff" />
            <stop offset="100%" stopColor="#5c4ed9" />
          </linearGradient>
        </defs>
      </svg>

      {spinning && (
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      )}
    </div>
  );
}
