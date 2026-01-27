'use client'

import dynamic from 'next/dynamic'

const StatusbarClient = dynamic(() => import('./statusbar-client'), {
  ssr: false,
})

export default function StatusbarLoader() {
  return <StatusbarClient />
}
