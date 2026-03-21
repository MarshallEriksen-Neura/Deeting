import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="relative min-h-screen bg-[var(--background)] px-6 py-12 lg:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
        <div className="absolute top-[20%] -right-[5%] h-[35%] w-[35%] rounded-full bg-[var(--teal-accent)]/5 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-10">
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-5 w-[36rem] max-w-full" />
        </div>

        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-border/60 bg-card/80 p-6">
            <div className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
