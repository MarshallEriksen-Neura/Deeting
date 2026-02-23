import useSWR from "swr"
import {
  fetchRoutingOverview,
  fetchStrategyConfig,
  fetchArmPerformance,
  fetchSkillMab,
  fetchAssistantMab,
  type RoutingOverview,
  type StrategyConfig,
  type ArmPerformanceResponse,
  type SkillMabResponse,
  type AssistantMabResponse,
} from "@/lib/api/routing-mab"

const SWR_OPTIONS = {
  refreshInterval: 30_000,
  revalidateOnFocus: true,
  dedupingInterval: 10_000,
} as const

export function useRoutingOverview(scene = "router:llm") {
  return useSWR<RoutingOverview>(
    ["routing-mab-overview", scene],
    () => fetchRoutingOverview(scene),
    SWR_OPTIONS
  )
}

export function useStrategyConfig() {
  return useSWR<StrategyConfig>(
    "routing-mab-strategy",
    fetchStrategyConfig,
    { ...SWR_OPTIONS, refreshInterval: 60_000 }
  )
}

export function useArmPerformance(scene = "router:llm") {
  return useSWR<ArmPerformanceResponse>(
    ["routing-mab-arms", scene],
    () => fetchArmPerformance(scene),
    SWR_OPTIONS
  )
}

export function useSkillMab() {
  return useSWR<SkillMabResponse>(
    "routing-mab-skills",
    fetchSkillMab,
    SWR_OPTIONS
  )
}

export function useAssistantMab() {
  return useSWR<AssistantMabResponse>(
    "routing-mab-assistants",
    fetchAssistantMab,
    SWR_OPTIONS
  )
}
