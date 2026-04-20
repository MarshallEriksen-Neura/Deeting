export function resolveIslandStatusLabelKey(statusLabel: string): string | null {
  switch (statusLabel) {
    case "Idle":
      return "island.status.idle";
    case "Ready":
      return "island.status.ready";
    case "Working...":
      return "island.status.working";
    case "Pending approval":
      return "island.status.pendingApproval";
    case "Needs attention":
      return "island.status.needsAttention";
    case "Completed":
      return "island.status.completed";
    default:
      return null;
  }
}
