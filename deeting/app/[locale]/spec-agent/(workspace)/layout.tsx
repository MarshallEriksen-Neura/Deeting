import { ReactNode } from 'react'

import { WorkspaceContent } from './components/workspace-content'

interface SpecAgentLayoutProps {
  statusbar: ReactNode
  console: ReactNode
  canvas: ReactNode
  modal: ReactNode
}

export default function SpecAgentLayout({
  statusbar,
  console,
  canvas,
  modal
}: SpecAgentLayoutProps) {
  return (
    <WorkspaceContent
      statusbar={statusbar}
      console={console}
      canvas={canvas}
      modal={modal}
    />
  )
}
