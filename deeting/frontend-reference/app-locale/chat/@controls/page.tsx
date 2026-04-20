import { Suspense } from 'react';
import ControlsContainer from '@/components/chat/console/controls-container';
import { ControlsSkeleton } from '@/components/common/skeletons';

export default function ControlsPage() {
  return (
    <Suspense fallback={<ControlsSkeleton />}>
      <ControlsContainer />
    </Suspense>
  )
}
