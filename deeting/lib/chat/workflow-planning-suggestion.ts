const PLANNING_KEYWORDS = [
  "plan",
  "workflow",
  "orchestrate",
  "orchestration",
  "phases",
  "phase",
  "steps",
  "step-by-step",
  "checklist",
  "roadmap",
  "migration",
  "rollout",
  "coordinate",
  "parallel",
  "approval",
  "审批",
  "编排",
  "计划",
  "阶段",
  "步骤",
  "清单",
  "迁移",
  "回滚",
  "发布",
  "并行",
  "协调",
]

const MULTI_STEP_CONNECTORS = [
  " then ",
  " after ",
  " before ",
  " and then ",
  " first ",
  " finally ",
  "同时",
  "然后",
  "之后",
  "先",
  "再",
  "并且",
]

function countKeywordMatches(input: string) {
  return PLANNING_KEYWORDS.reduce((count, keyword) => {
    return input.includes(keyword) ? count + 1 : count
  }, 0)
}

function countConnectorMatches(input: string) {
  return MULTI_STEP_CONNECTORS.reduce((count, keyword) => {
    return input.includes(keyword) ? count + 1 : count
  }, 0)
}

export function shouldSuggestWorkflowPlanning(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return false

  const keywordMatches = countKeywordMatches(normalized)
  const connectorMatches = countConnectorMatches(normalized)
  const lineBreakCount = (normalized.match(/\n/g) ?? []).length
  const commaCount = (normalized.match(/[，,、;]/g) ?? []).length
  const sentenceCount = normalized
    .split(/[.!?。！？\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean).length

  if (keywordMatches >= 2) return true
  if (keywordMatches >= 1 && connectorMatches >= 1) return true
  if (keywordMatches >= 1 && normalized.length >= 70) return true
  if (connectorMatches >= 2 && sentenceCount >= 2) return true
  if (normalized.length >= 140 && (sentenceCount >= 2 || commaCount >= 3 || lineBreakCount >= 1)) {
    return true
  }

  return false
}
