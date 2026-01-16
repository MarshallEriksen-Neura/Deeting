import { Suspense } from 'react';
import { SelectAgentContainer } from '../components/select-agent-container';
import { SelectAgentSkeleton } from '../components/select-agent-skeleton';

export default function SelectAgentModal() {
  return (
    <Suspense fallback={<SelectAgentSkeleton />}>
      <SelectAgentContainer />
    </Suspense>
  )
}