export type ParsedTaskAgentMention = {
  agentName: string
  prompt: string
}

export type LeadingTaskAgentMentionDraft = {
  query: string
  prompt: string
}

export type MentionableTaskAgent = {
  id: string
  name: string
}

export function getLeadingTaskAgentMentionDraft(
  input: string,
): LeadingTaskAgentMentionDraft | null {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith("@")) return null

  const body = trimmed.slice(1).trimStart()
  if (!body) {
    return {
      query: "",
      prompt: "",
    }
  }

  const separatorIndex = body.search(/\s/)
  if (separatorIndex < 0) {
    return {
      query: body,
      prompt: "",
    }
  }

  return {
    query: body.slice(0, separatorIndex).trim(),
    prompt: body.slice(separatorIndex).trimStart(),
  }
}

export function getLeadingTaskAgentMentionQuery(
  input: string,
): string | null {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith("@")) return null
  return trimmed.slice(1).trimStart()
}

export function buildLeadingTaskAgentMentionInput(
  agentName: string,
  prompt: string,
): string {
  const trimmedAgentName = agentName.trim()
  const trimmedPrompt = prompt.trimStart()
  return trimmedPrompt
    ? `@${trimmedAgentName} ${trimmedPrompt}`
    : `@${trimmedAgentName} `
}

export function parseLeadingTaskAgentMention(
  input: string,
): ParsedTaskAgentMention | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("@")) return null

  const body = trimmed.slice(1).trimStart()
  if (!body) return null

  const separatorIndex = body.search(/\s/)
  if (separatorIndex < 0) {
    return {
      agentName: body.trim(),
      prompt: "",
    }
  }

  const agentName = body.slice(0, separatorIndex).trim()
  const prompt = body.slice(separatorIndex).trim()
  if (!agentName) return null

  return {
    agentName,
    prompt,
  }
}

export function resolveLeadingTaskAgentMention(
  input: string,
  agents: MentionableTaskAgent[],
): {
  mention: ParsedTaskAgentMention
  agent: MentionableTaskAgent | null
} | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("@")) return null

  const body = trimmed.slice(1).trimStart()
  if (!body) return null

  const sortedAgents = [...agents].sort(
    (left, right) => right.name.trim().length - left.name.trim().length,
  )
  const resolvedAgent = sortedAgents.find((item) => {
    const normalizedName = item.name.trim().toLowerCase()
    if (!normalizedName) return false
    const normalizedBody = body.toLowerCase()
    if (!normalizedBody.startsWith(normalizedName)) return false
    const nextChar = body.charAt(item.name.trim().length)
    return !nextChar || /\s/.test(nextChar)
  })

  if (resolvedAgent) {
    const agentName = resolvedAgent.name.trim()
    return {
      mention: {
        agentName,
        prompt: body.slice(agentName.length).trim(),
      },
      agent: resolvedAgent,
    }
  }

  const mention = parseLeadingTaskAgentMention(input)
  if (!mention) return null

  const normalizedName = mention.agentName.trim().toLowerCase()
  const agent =
    agents.find((item) => item.name.trim().toLowerCase() === normalizedName) ?? null

  return {
    mention,
    agent,
  }
}
