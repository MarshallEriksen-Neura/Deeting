import { ReactNode } from 'react'
import { WorkspaceShell } from '@/components/common/workspace'

export default function SpecAgentLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <WorkspaceShell workspace={<div />}>
      <div className="h-screen w-full bg-background">
        {children}
      </div>
    </WorkspaceShell>
  )
}