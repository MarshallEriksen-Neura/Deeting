/**
 * 侧边栏组件集合
 * 基于 shadcn/ui Sidebar 封装
 */

export { AdaptiveSidebar } from "./adaptive-sidebar";

// 重新导出 shadcn sidebar 的所有子组件
export {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
