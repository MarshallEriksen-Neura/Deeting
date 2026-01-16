import { Skeleton } from "@/components/ui/skeleton"

export function ControlsSkeleton() {
  return (
    <div className="flex items-center p-1.5 min-h-[60px] relative w-full">
        <Skeleton className="w-10 h-10 rounded-full mr-2" />
        <div className="flex-1 px-4">
             <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="w-10 h-10 rounded-full ml-2" />
    </div>
  )
}
