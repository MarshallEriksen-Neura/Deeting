import { ModelManagementPage } from "@/components/models"

interface PageProps {
  params: Promise<{
    locale: string
    instanceId: string
  }>
}

export default async function ModelsPage({ params }: PageProps) {
  const { instanceId } = await params

  return <ModelManagementPage instanceId={instanceId} />
}
