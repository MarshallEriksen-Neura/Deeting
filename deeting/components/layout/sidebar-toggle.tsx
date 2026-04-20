"use client";

export function SidebarToggle() {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--ink-2)]"
      aria-label="Toggle sidebar"
    >
      Sidebar
    </button>
  );
}
