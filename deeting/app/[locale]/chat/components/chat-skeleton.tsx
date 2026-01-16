import { Skeleton } from "@/components/ui/skeleton"

export function ChatSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      {/* 1. Header Skeleton */}
      <header className="h-14 border-b flex items-center px-4 justify-between bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {/* Back Button Skeleton (Mobile) */}
          <Skeleton className="h-8 w-8 rounded-md md:hidden" />
          {/* Avatar Skeleton */}
          <Skeleton className="h-8 w-8 rounded-lg" />
          {/* Name & Status Skeleton */}
          <div className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-3">
           {/* Model Select Skeleton */}
           <Skeleton className="h-7 w-[140px] rounded-full" />
           {/* Stream Toggle Skeleton */}
           <Skeleton className="h-7 w-[100px] rounded-full" />
        </div>
      </header>

      {/* 2. Message Area Skeleton */}
      <div className="flex-1 p-4 space-y-6 overflow-hidden">
        <div className="max-w-3xl mx-auto space-y-8 py-4">
          
          {/* Greeting from Assistant */}
          <div className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 max-w-[80%]">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[140px]" />
            </div>
          </div>

          {/* Fake History (Right) */}
          <div className="flex gap-3 flex-row-reverse">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 max-w-[80%]">
               <Skeleton className="h-10 w-[240px] rounded-2xl rounded-tr-sm" />
            </div>
          </div>

           {/* Fake Response (Left) */}
           <div className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 w-full max-w-[80%]">
              <Skeleton className="h-32 w-full rounded-2xl rounded-tl-sm" />
            </div>
          </div>

        </div>
      </div>

      {/* 3. Input Area Skeleton */}
      <div className="p-4 border-t bg-background/80 backdrop-blur">
        <div className="max-w-3xl mx-auto relative">
          <Skeleton className="h-[52px] w-full rounded-full" />
        </div>
        <div className="flex justify-center mt-2">
           <Skeleton className="h-3 w-48" />
        </div>
      </div>
    </div>
  )
}
