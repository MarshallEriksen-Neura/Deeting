import { PageHeader } from "./components/page-header";
import { RuleManagementClient } from "./components/rule-management-client";

/**
 * Provider rule management page
 * Generate, view, and rollback provider capability rules
 */
export default function AdminRulesPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader />
      <RuleManagementClient />
    </div>
  );
}
