import { Suspense } from 'react';
import ControlsContainer from '../components/controls-container';
import { ControlsSkeleton } from '../components/controls-skeleton';

export default function ControlsPage() {
  return (
    <Suspense fallback={<ControlsSkeleton />}>
      <ControlsContainer />
    </Suspense>
  )
}
