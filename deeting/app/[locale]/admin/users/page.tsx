import { AdminAccessGate } from "@/components/admin/admin-access-gate"
import { UsersAdminPage } from "./users-admin-page"

export default function Page() {
  return (
    <AdminAccessGate>
      <UsersAdminPage />
    </AdminAccessGate>
  )
}
