export default function Canvas() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
       <div className="relative">
          <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 opacity-20 blur-3xl animate-pulse" />
          <h1 className="relative text-6xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-black/80 to-black/20 dark:from-white dark:to-white/40">
             Deeting OS
          </h1>
       </div>
       <div className="mt-4 text-sm text-black/60 dark:text-white/40 font-mono flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
          System Online. Awaiting Input.
       </div>
    </div>
  );
}
