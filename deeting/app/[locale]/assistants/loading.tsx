import { Skeleton } from "@/components/ui/skeleton"

export default function AssistantsLoading() {
  return (
    <main className="min-h-screen bg-muted/20 p-8">
      <div className="space-y-8">
        <section className="mx-auto max-w-2xl space-y-4 py-10 text-center">
          <Skeleton className="mx-auto h-10 w-72 max-w-full" />
          <Skeleton className="mx-auto h-6 w-[32rem] max-w-full" />
        </section>

        <div className="space-y-8 pb-20">
          <div className="mx-auto max-w-2xl space-y-6">
            <div className="flex justify-center">
              <Skeleton className="h-11 w-36 rounded-xl" />
            </div>

            <div className="rounded-xl border border-border/50 bg-background p-2 shadow-xl">
              <div className="flex items-center gap-3 px-3">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-12 flex-1 rounded-lg" />
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-20 rounded-full" />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm"
              >
                <div className="space-y-4">
                  <Skeleton className="h-12 w-12 rounded-2xl" />
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
