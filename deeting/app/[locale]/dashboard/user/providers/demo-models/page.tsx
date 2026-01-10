import { ModelManagementPage } from "@/components/models"

/**
 * Models Demo Page
 *
 * Direct access to the Model Management page for development/preview.
 * Access via: /dashboard/user/providers/demo-models
 */
export default function ModelsDemo() {
  return <ModelManagementPage instanceId="demo" />
}
