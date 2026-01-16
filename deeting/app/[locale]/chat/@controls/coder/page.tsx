import { Suspense } from 'react';
import CoderConsole from '../../components/coder-console';
import { CoderSkeleton } from '../../components/coder-skeleton';

export default function CoderPage() {
  return (
    <Suspense fallback={<CoderSkeleton />}>
      <CoderConsole />
    </Suspense>
  )
}
