import { AdminClient } from './components/admin-client';
import { PageHeader } from './components/page-header';

/**
 * 系统管理页面（服务端组件）
 * 负责页面布局和结构
 */
export default function SystemAdminPage() {
  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader />
      <AdminClient />
    </div>
  );
}
