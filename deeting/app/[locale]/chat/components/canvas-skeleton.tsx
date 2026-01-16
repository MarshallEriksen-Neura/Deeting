export function CanvasSkeleton() {
  return (
     <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
         {/* Simple placeholder for initial load */}
         <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="h-8 w-48 bg-white/5 rounded-lg" />
            <div className="h-4 w-32 bg-white/5 rounded-lg" />
         </div>
     </div>
  )
}
