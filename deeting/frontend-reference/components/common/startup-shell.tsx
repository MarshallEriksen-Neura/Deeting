type StartupShellStep = {
  label: string
  hint: string
  state?: "active" | "pending" | "done"
}

type StartupShellProps = {
  label?: string
  detail?: string
  badge?: string
  tone?: "page" | "overlay"
  steps?: StartupShellStep[]
}

const DEFAULT_STEPS: StartupShellStep[] = [
  {
    label: "Runtime",
    hint: "Connecting desktop services and local state",
    state: "done",
  },
  {
    label: "Memory",
    hint: "Warming search and workspace context",
    state: "active",
  },
  {
    label: "Interface",
    hint: "Painting the shell and current route",
    state: "pending",
  },
]

export function StartupShell({
  label = "Loading Deeting",
  detail = "Preparing the desktop workspace",
  badge = "Desktop Startup",
  tone = "page",
  steps = DEFAULT_STEPS,
}: StartupShellProps) {
  const isOverlay = tone === "overlay"
  const containerClassName = isOverlay
    ? "relative flex min-h-full items-center justify-center overflow-hidden px-4 py-6 text-[var(--foreground)]"
    : "relative flex min-h-[var(--app-viewport-height,100dvh)] items-center justify-center overflow-hidden px-6 text-[var(--foreground)]"
  const panelClassName = isOverlay
    ? "relative flex w-full max-w-lg flex-col gap-6 rounded-[30px] border border-white/15 bg-[rgba(18,20,31,0.72)] px-6 py-7 text-left shadow-[0_36px_120px_-52px_rgba(8,12,28,0.7)] backdrop-blur-2xl"
    : "relative flex w-full max-w-3xl flex-col gap-8 rounded-[34px] border border-white/45 bg-[rgba(255,255,255,0.78)] px-7 py-7 text-left shadow-[0_50px_160px_-64px_rgba(24,34,66,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(18,20,31,0.78)] md:px-9 md:py-9"

  return (
    <main className={containerClassName}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(124,109,255,0.22),transparent_36%),radial-gradient(circle_at_84%_16%,rgba(33,201,195,0.18),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(103,125,255,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0))]" />
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:linear-gradient(rgba(124,109,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(124,109,255,0.07)_1px,transparent_1px)] [background-size:30px_30px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-10%] h-64 w-64 -translate-x-1/2 rounded-full bg-[var(--primary)]/10 blur-3xl" />

      <section className={panelClassName}>
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/10" />
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />

        <div className="grid gap-7 md:grid-cols-[1.2fr_0.8fr] md:items-center">
          <div className="space-y-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--primary)]/85">
              <span className="h-2 w-2 rounded-full bg-[var(--teal-accent)] shadow-[0_0_10px_rgba(33,201,195,0.7)]" />
              {badge}
            </div>

            <div className="space-y-3">
              <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] md:text-[2.65rem]">
                {label}
              </h1>
              <p className="max-w-xl text-sm leading-7 text-[var(--muted-foreground)] md:text-[15px]">
                {detail}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--foreground)]/8">
                <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,var(--primary),var(--teal-accent),var(--primary-soft))] animate-[shimmer_1.8s_linear_infinite] bg-[length:200%_100%]" />
              </div>
              <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted-foreground)]/90">
                Booting
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 rounded-[28px] bg-[linear-gradient(180deg,rgba(124,109,255,0.12),rgba(124,109,255,0.04))] blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-white/40 bg-[rgba(255,255,255,0.55)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-[rgba(255,255,255,0.04)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="mb-4 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                <span>Launch Sequence</span>
                <span>Live</span>
              </div>

              <div className="space-y-3">
                {steps.map((step, index) => {
                  const state = step.state ?? "pending"
                  const accentClassName =
                    state === "done"
                      ? "bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.55)]"
                      : state === "active"
                        ? "bg-[var(--primary)] shadow-[0_0_14px_rgba(124,109,255,0.65)]"
                        : "bg-[var(--foreground)]/20"
                  const rowClassName =
                    state === "active"
                      ? "border-[var(--primary)]/20 bg-[var(--primary)]/8"
                      : "border-white/40 bg-white/45 dark:border-white/8 dark:bg-white/[0.02]"

                  return (
                    <div
                      key={`${step.label}-${index}`}
                      className={`flex items-start gap-3 rounded-2xl border px-3 py-3 transition-colors ${rowClassName}`}
                    >
                      <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-white/50 bg-white/70 dark:border-white/10 dark:bg-white/[0.04]">
                        <span className={`h-2.5 w-2.5 rounded-full ${accentClassName}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-[var(--foreground)]">{step.label}</p>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                            {state}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                          {step.hint}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
