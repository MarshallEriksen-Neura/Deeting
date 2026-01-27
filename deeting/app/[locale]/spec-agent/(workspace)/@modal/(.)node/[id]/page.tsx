import NodeDetailDrawerLoader from './components/node-detail-drawer-loader'

export default function NodeDetailModalPage({
  params,
}: {
  params: { id: string }
}) {
  return <NodeDetailDrawerLoader params={params} />
}
