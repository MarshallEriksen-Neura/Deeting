'use client'

import dynamic from 'next/dynamic'

const CanvasClient = dynamic(() => import('./canvas-client'), {
  ssr: false,
})

export default function CanvasLoader() {
  return <CanvasClient />
}
