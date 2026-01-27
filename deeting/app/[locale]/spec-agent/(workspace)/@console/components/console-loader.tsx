'use client'

import dynamic from 'next/dynamic'

const ConsoleClient = dynamic(() => import('./console-client'), {
  ssr: false,
})

export default function ConsoleLoader() {
  return <ConsoleClient />
}
