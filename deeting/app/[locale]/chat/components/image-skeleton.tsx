import { Skeleton } from "@/components/ui/skeleton"

export function ImageSkeleton() {
  return (
    <div className="flex h-full w-full">
      <div className="w-16 border-r border-white/5 flex flex-col items-center py-4 gap-4 bg-white/[0.02]">
         <Skeleton className="w-8 h-8 rounded-lg" />
         <div className="mt-4 space-y-4">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="w-8 h-8 rounded-lg" />
         </div>
      </div>
      <div className="flex-1 p-5 flex flex-col">
         <Skeleton className="w-24 h-4 mb-4 rounded" />
         <Skeleton className="w-full h-32 rounded-xl mb-4" />
         <div className="flex gap-2 mt-auto">
             <Skeleton className="w-20 h-6 rounded-md" />
             <Skeleton className="w-24 h-6 rounded-md" />
         </div>
      </div>
      <div className="w-48 border-l border-white/5 p-4 flex flex-col gap-4">
         <Skeleton className="w-full h-24 rounded-lg" />
         <Skeleton className="w-full h-12 rounded-lg mt-auto" />
      </div>
    </div>
  )
}
