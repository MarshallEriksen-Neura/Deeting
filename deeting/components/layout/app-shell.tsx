"use client";

import type { PropsWithChildren } from "react";
import { SidebarProvider, useSidebar } from "@/components/ui/shadcn/sidebar";
import { WorkstationSidebar } from "@/components/layout/workstation-sidebar";
import { cn } from "@/lib/utils";

const shellStats = [
  {
    label: "CURRENT WINDOW",
    value: "21k",
    note: "骨架只保留信息密度和层级，不引入真实业务内容。",
  },
  {
    label: "MEMORY STACK",
    value: "1.4k",
    note: "保留桌面工作台布局节奏，避免营销页式大标题。",
  },
  {
    label: "TOKEN OUTPUT",
    value: "2.7k",
    note: "结构优先，所有面板都作为可替换骨架存在。",
  },
];

const assemblyBlocks: Array<{
  label: string;
  value: string;
  tone: "neutral" | "accent";
}> = [
  { label: "System / Rules", value: "800 tokens", tone: "neutral" },
  { label: "Current Flow", value: "2500 tokens", tone: "neutral" },
  { label: "Memory Fragments", value: "350 tokens", tone: "neutral" },
  { label: "Tool Results", value: "1200 tokens", tone: "accent" },
];

const primitiveRows = [
  { label: "pref", value: "用户偏好 / 外壳边界 / 默认骨架", state: "pinned" },
  { label: "fact", value: "产品约束 / Model / Tools / Context", state: "core" },
  { label: "rule", value: "工具接入走上下文编排逻辑", state: "guard" },
  { label: "link", value: "结构骨架替换内容是一等能力", state: "route" },
];

const pipelineSteps = [
  "Raw Stack",
  "Filter",
  "Summarize",
  "Rank",
  "Pin Model Slot",
  "Send",
];

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <section className="ws-bezel min-h-[152px]">
      <div className="ws-bezel-inner flex h-full flex-col justify-between px-5 py-4">
        <div className="text-[11px] font-medium tracking-[0.22em] text-[var(--ink-3)] uppercase">
          {label}
        </div>
        <div className="text-[clamp(2.4rem,3vw,3.2rem)] font-semibold leading-none tracking-[-0.06em] text-[var(--ink)]">
          {value}
        </div>
        <p className="max-w-[28ch] text-sm leading-6 text-[var(--ink-2)]">{note}</p>
      </div>
    </section>
  );
}

function AssemblyMiniCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "accent";
}) {
  return (
    <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3">
      <div className="text-[11px] font-medium tracking-[-0.01em] text-[var(--ink-2)]">
        {label}
      </div>
      <div className="mt-1 text-[11px] text-[var(--ink-3)]">建议注入 {value}</div>
      <div className="mt-3 h-2.5 rounded-full bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] p-[2px]">
        <div
          className={tone === "accent" ? "h-full w-[72%] rounded-full bg-[linear-gradient(90deg,#8f7bff_0%,#caa34d_100%)]" : "h-full w-[48%] rounded-full bg-[var(--ink)]"}
        />
      </div>
    </div>
  );
}

function AppShellBody({
  children,
  locale,
}: PropsWithChildren<{ locale: string }>) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 transition-[grid-template-columns] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)]",
        isCollapsed
          ? "grid-cols-[68px_minmax(0,1fr)]"
          : "grid-cols-[264px_minmax(0,1fr)]"
      )}
    >
      <WorkstationSidebar />

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--shell-inspector-w)]">
        <main className="min-w-0 border-r border-[var(--hairline)] bg-[var(--window-bg)]">
          <div className="flex h-full flex-col px-[var(--shell-canvas-px)] pb-[var(--shell-canvas-pb)] pt-[var(--shell-canvas-pt)]">
            <section id="overview" className="scroll-mt-24">
              <div className="grid gap-4 xl:grid-cols-3">
                {shellStats.map((item) => (
                  <StatCard key={item.label} {...item} />
                ))}
              </div>
            </section>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.28fr)_minmax(0,1fr)]">
              <section id="assembly" className="ws-bezel min-h-[348px] scroll-mt-24">
                <div className="ws-bezel-inner flex h-full flex-col px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                        Context Window Assembly
                      </h2>
                      <p className="mt-1 max-w-[44ch] text-sm leading-6 text-[var(--ink-2)]">
                        按 DESIGN.md 的工作台节奏组织模块，仅保留结构、密度与面板分区。
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium tracking-[0.16em] text-white uppercase">
                      active
                    </span>
                  </div>

                  <div className="mt-5 grid flex-1 gap-4 md:grid-cols-2">
                    {assemblyBlocks.map((block) => (
                      <AssemblyMiniCard key={block.label} {...block} />
                    ))}
                  </div>
                </div>
              </section>

              <aside id="memory" className="ws-bezel min-h-[348px] scroll-mt-24">
                <div className="ws-bezel-inner flex h-full flex-col px-5 py-4">
                  <div>
                    <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                      Memory Primitives
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-2)]">
                      这里保留行式 inspector 风格，不承载真实内容，仅示意属性密度。
                    </p>
                  </div>

                  <div className="mt-5 flex-1 divide-y divide-[var(--hairline)] overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
                    {primitiveRows.map((row) => (
                      <div
                        key={row.label}
                        className="grid min-h-[68px] grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
                      >
                        <div className="font-mono text-xs tracking-[0.08em] text-[var(--ink-3)]">
                          {row.label}
                        </div>
                        <div className="text-sm leading-6 text-[var(--ink-2)]">
                          {row.value}
                        </div>
                        <div className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-[var(--ink-3)] uppercase">
                          {row.state}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>

            <section id="pipeline" className="mt-5 ws-bezel min-h-[156px] scroll-mt-24">
              <div className="ws-bezel-inner flex h-full flex-col px-5 py-4">
                <div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    Context Fragment Pipeline
                  </h2>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {pipelineSteps.map((step) => (
                    <div
                      key={step}
                      className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-medium text-[var(--ink-2)]"
                    >
                      {step}
                    </div>
                  ))}
                </div>

                <div className="mt-auto text-xs text-[var(--ink-3)]">
                  主画布只展示骨架编排，实际内容由后续视图替换。
                </div>
              </div>
            </section>

            <section id="surface" className="mt-5 min-h-[220px] scroll-mt-24">
              {children}
            </section>
          </div>
        </main>

        <aside id="inspector" className="min-h-0 bg-[var(--panel-bg)] scroll-mt-24">
          <div className="flex h-full flex-col">
            <header className="flex h-10 items-center justify-between border-b border-[var(--hairline)] px-4">
              <div>
                <div className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  Inspector
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2.5 py-1 text-[11px] font-medium tracking-[0.1em] text-[var(--ink-3)] uppercase"
                >
                  pin
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)]"
                >
                  ×
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="ws-bezel min-h-full">
                <div className="ws-bezel-inner h-full px-4 py-3">
                  <div className="text-[11px] font-medium tracking-[0.18em] text-[var(--ink-3)] uppercase">
                    Surface meta
                  </div>

                  <div className="mt-4 divide-y divide-[var(--hairline)] rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
                    {[
                      ["route", "workspace/context"],
                      ["density", "comfortable"],
                      ["state", "skeleton only"],
                      ["locale", locale],
                      ["focus", "chrome shell"],
                      ["motion", "reduced-ready"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="grid grid-cols-[68px_minmax(0,1fr)] items-center gap-3 px-3 py-3"
                      >
                        <div className="text-xs text-[var(--ink-3)]">{label}</div>
                        <div className="text-right font-mono text-xs tabular-nums text-[var(--ink)]">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5">
                    <div className="text-[11px] font-medium tracking-[0.18em] text-[var(--ink-3)] uppercase">
                      Notes
                    </div>
                    <div className="mt-3 rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3 text-sm leading-6 text-[var(--ink-2)]">
                      该区域固定作为 inspector 占位，不承载真实交互，仅确保整体壳层比例、边界和信息节奏正确。
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  locale,
}: PropsWithChildren<{ locale: string }>) {
  return (
    <SidebarProvider defaultOpen>
      <div className="min-h-[calc(100dvh-var(--desktop-title-bar-height,0px))] overflow-x-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_26%),var(--window-bg)] text-[var(--ink)]">
        <div className="flex min-h-[calc(100dvh-var(--desktop-title-bar-height,0px))] flex-col">
          <AppShellBody locale={locale}>{children}</AppShellBody>

          <footer className="flex h-[var(--shell-statusbar-h)] items-center justify-between border-t border-[var(--hairline)] bg-[var(--chrome-bg)] px-4 text-[11px] text-[var(--ink-3)]">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[var(--ok)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                Connected
              </span>
              <span>Agent idle</span>
              <span className="font-mono tabular-nums">latency 84ms</span>
            </div>
            <div className="font-mono tabular-nums">deeting.shell.alpha</div>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
