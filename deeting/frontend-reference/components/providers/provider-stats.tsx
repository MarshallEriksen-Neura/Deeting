import { type ProviderHubStats } from "@/lib/api/providers"

interface ProviderStatsProps {
  stats?: ProviderHubStats
}

export default function ProviderStats({ stats }: ProviderStatsProps) {
  if (!stats) return null

  return (
    <span className="ml-2 text-sm">
      ({stats.total} providers, {stats.connected} connected)
    </span>
  )
}