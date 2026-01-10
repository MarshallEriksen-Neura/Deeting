import { PageHeader } from "./components/page-header";
import { AgentTaskManagementClient } from "./components/agent-task-management-client";

/**
 * Agent task management page
 * Manage crawl, extract, and analyze tasks
 */
export default function AdminAgentsPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader />
      <AgentTaskManagementClient />
    </div>
  );
}
