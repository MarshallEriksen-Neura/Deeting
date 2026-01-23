import { Suspense } from 'react';
import CanvasContainer from '@/components/image/canvas/canvas-container';
import { CanvasSkeleton } from '@/components/common/skeletons';

export default function CanvasPage() {
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <CanvasContainer />
    </Suspense>
  )
}
