import NodeDetailStandaloneLoader from './components/node-detail-standalone-loader'

export function generateStaticParams() {
  return [{ id: "default" }]
}

export default function NodeDetailPage({ params }: { params: { id: string } }) {
  return <NodeDetailStandaloneLoader params={params} />
}
