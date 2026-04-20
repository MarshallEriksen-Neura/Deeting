export default function LocaleHomePage() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
      <section className="ws-bezel min-h-[260px]">
        <div className="ws-bezel-inner flex h-full flex-col px-5 py-4">
          <div className="text-[11px] font-medium tracking-[0.2em] text-[var(--ink-3)] uppercase">
            Workspace Surface
          </div>
          <div className="mt-3 max-w-3xl text-[28px] font-semibold leading-[1.08] tracking-[-0.06em] text-[var(--ink)]">
            当前页面只承载工作台骨架，后续视图直接替换这块内容区。
          </div>
          <p className="mt-4 max-w-[62ch] text-sm leading-7 text-[var(--ink-2)]">
            保持桌面应用式工作区，不放营销内容，不做额外叙事；这里只验证留白、面板层级和阅读节奏。
          </p>

          <div className="mt-auto grid gap-3 md:grid-cols-3">
            {[
              ["region", "canvas"],
              ["layout", "nested shell"],
              ["intent", "replaceable"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">{label}</div>
                <div className="mt-2 font-mono text-sm tabular-nums text-[var(--ink)]">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ws-bezel min-h-[260px]">
        <div className="ws-bezel-inner flex h-full flex-col px-5 py-4">
          <div className="text-[11px] font-medium tracking-[0.2em] text-[var(--ink-3)] uppercase">
            Secondary Rail
          </div>
          <div className="mt-3 space-y-3">
            {[
              "Pane proportions stay fixed",
              "Toolbar stays attached to chrome",
              "Numbers use mono and tabular rhythm",
              "Inspector remains visible as skeleton",
            ].map((item) => (
              <div key={item} className="rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3 text-sm text-[var(--ink-2)]">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
