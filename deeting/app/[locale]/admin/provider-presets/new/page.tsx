import { AdminAccessGate } from "@/components/admin/admin-access-gate"
import { PageContent } from "./page-content"

export default function Page() {
  return (
    <AdminAccessGate>
      <PageContent />
    </AdminAccessGate>
  )
}
