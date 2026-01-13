import { Suspense } from "react"
import ProviderMarketClient from "./client"
import ProviderMarketSkeleton from "./loading"

export default function ProviderMarketPage() {
  return (
    <div className="space-y-8 p-6 lg:p-10 max-w-[1600px] mx-auto min-h-screen">
      <Suspense fallback={<ProviderMarketSkeleton />}>
        <ProviderMarketClient />
      </Suspense>
    </div>
  )
}