import { Skeleton } from "@/components/ui/skeleton"
import { X } from "lucide-react"

export function SelectAgentSkeleton() {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden ring-1 ring-white/5">
        {/* Background Effects */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-purple-500/10 blur-[80px] rounded-full" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full" />

        <div className="absolute top-6 right-6">
           <div className="p-2 bg-white/5 rounded-full">
              <X className="w-5 h-5 text-white/30" />
           </div>
        </div>

        <div className="mb-8">
           <Skeleton className="h-8 w-48 bg-white/10 mb-2" />
           <Skeleton className="h-4 w-72 bg-white/5" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
             <div key={i} className="relative flex flex-col text-left p-5 rounded-2xl bg-white/5 border border-white/5">
                <Skeleton className="h-10 w-10 rounded-xl bg-white/10 mb-4" />
                <Skeleton className="h-5 w-24 bg-white/10 mb-1" />
                <Skeleton className="h-4 w-full bg-white/5" />
             </div>
          ))}
        </div>
      </div>
    </div>
  )
}
