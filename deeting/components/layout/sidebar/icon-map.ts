import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BarChart3,
  Bell,
  Cpu,
  Database,
  FileText,
  Key,
  LayoutDashboard,
  Lock,
  PanelLeft,
  PanelLeftClose,
  Plug,
  Route,
  Server,
  Settings,
  Shield,
  UserCog,
  Users,
} from "lucide-react"

// Icon registry for sidebar navigation. We keep icons in client components
// and reference them by string name in navigation config to avoid
// non-serializable values being passed from Server to Client Components.
export const navIconMap = {
  layoutDashboard: LayoutDashboard,
  route: Route,
  server: Server,
  plug: Plug,
  cpu: Cpu,
  key: Key,
  activity: Activity,
  fileText: FileText,
  users: Users,
  shield: Shield,
  lock: Lock,
  database: Database,
  settings: Settings,
  barChart3: BarChart3,
  bell: Bell,
  userCog: UserCog,
  panelLeft: PanelLeft,
  panelLeftClose: PanelLeftClose,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof navIconMap

export const defaultNavIcon: LucideIcon = LayoutDashboard
