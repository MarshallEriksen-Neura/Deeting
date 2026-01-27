'use client'

import dynamic from 'next/dynamic'

const NodeDetailDrawerClient = dynamic(
  () => import('./node-detail-drawer-client'),
  { ssr: false }
)

export default function NodeDetailDrawerLoader({
  params,
}: {
  params: { id: string }
}) {
  return <NodeDetailDrawerClient params={params} />
}
