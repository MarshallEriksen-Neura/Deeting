import { Container } from "@/components/ui/container"
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <DashboardLoadingCard key={index} className="h-[132px]" />
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardLoadingCard className="h-[360px]" />
        </div>
        <div className="lg:col-span-1">
          <DashboardLoadingCard className="h-[360px]" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardLoadingCard className="h-[320px]" />
        <DashboardLoadingCard className="h-[320px]" />
      </div>
    </Container>
  )
}

function DashboardLoadingCard({ className }: { className?: string }) {
  return (
    <div className={`rounded-3xl border border-border/60 bg-card/80 p-6 ${className ?? ""}`}>
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}
