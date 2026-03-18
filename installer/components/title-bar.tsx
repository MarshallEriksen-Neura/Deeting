"use client";

export function TitleBar({ onClose }: { onClose: () => void }) {
  return (
    <div
      data-tauri-drag-region
      className="relative z-20 flex items-center justify-between h-9 px-4"
      style={{ background: "rgba(10, 11, 20, 0.6)" }}
    >
      <span className="text-xs text-[var(--text-muted)] font-medium tracking-wide">
        Deeting Setup
      </span>

      <div className="flex items-center gap-1">
        {/* 最小化 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 transition-colors"
          onClick={async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              getCurrentWindow().minimize();
            } catch {}
          }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-[var(--text-muted)]">
            <rect width="10" height="1" rx="0.5" />
          </svg>
        </button>

        {/* 关闭 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 hover:text-red-400 transition-colors text-[var(--text-muted)]"
          onClick={onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
