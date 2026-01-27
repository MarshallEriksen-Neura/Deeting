'use client'

import dynamic from 'next/dynamic'

const NodeDetailStandaloneClient = dynamic(
  () => import('./node-detail-standalone-client'),
  { ssr: false }
)

export default function NodeDetailStandaloneLoader({
  params,
}: {
  params: { id: string }
}) {
  return <NodeDetailStandaloneClient params={params} />
}
