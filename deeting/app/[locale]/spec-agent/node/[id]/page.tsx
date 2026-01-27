import NodeDetailStandaloneLoader from './components/node-detail-standalone-loader'

export default function NodeDetailPage({ params }: { params: { id: string } }) {
  return <NodeDetailStandaloneLoader params={params} />
}
