export function resolveIslandStatusLabelKey(statusLabel: string): string | null {
  switch (statusLabel) {
    case "Idle":
      return "status.idle";
    case "Ready":
      return "status.ready";
    case "Working...":
      return "status.working";
    case "Pending approval":
      return "status.pendingApproval";
    case "Needs attention":
      return "status.needsAttention";
    case "Completed":
      return "status.completed";
    default:
      return null;
  }
}

