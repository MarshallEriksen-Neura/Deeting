export function isBrowserAgentPanelEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL === "true"
  )
}
