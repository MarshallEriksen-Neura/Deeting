import { AdminAccessGate } from "@/components/admin/admin-access-gate"
import { ProviderPresetsAdminPage } from "./provider-presets-admin-page"

export default function Page() {
  return (
    <AdminAccessGate>
      <ProviderPresetsAdminPage />
    </AdminAccessGate>
  )
}
