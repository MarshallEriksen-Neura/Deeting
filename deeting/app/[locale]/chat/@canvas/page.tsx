import { Suspense } from 'react';
import CanvasContainer from '../components/canvas-container';
import { CanvasSkeleton } from '../components/canvas-skeleton';

export default function CanvasPage() {
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <CanvasContainer />
    </Suspense>
  )
}
