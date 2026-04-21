import type { CSSProperties, ReactNode } from "react";

const fullBleedCanvasVars = {
  "--shell-canvas-px": "0px",
  "--shell-canvas-pt": "0px",
  "--shell-canvas-pb": "0px",
} as CSSProperties;

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return <div style={fullBleedCanvasVars}>{children}</div>;
}
