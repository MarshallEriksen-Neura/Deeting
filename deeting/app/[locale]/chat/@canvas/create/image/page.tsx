import { Suspense } from 'react';
import ImageDashboard from '../../../components/image-dashboard';
import { ImageSkeleton } from '../../../components/image-skeleton';

export default function ImageCanvasPage() {
  return (
    <Suspense fallback={<ImageSkeleton />}>
      <ImageDashboard />
    </Suspense>
  );
}
