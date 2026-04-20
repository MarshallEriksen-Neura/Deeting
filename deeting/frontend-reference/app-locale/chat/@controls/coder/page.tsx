import { Suspense } from 'react';
import { CoderConsole } from '@/components/chat/console/coder-console';
import { CoderSkeleton } from '@/components/common/skeletons';

export default function CoderPage() {
  return (
    <Suspense fallback={<CoderSkeleton />}>
      <CoderConsole />
    </Suspense>
  )
}
