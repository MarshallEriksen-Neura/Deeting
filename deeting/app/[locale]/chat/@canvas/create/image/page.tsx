import { Suspense } from 'react';
import ImageDashboard from '@/components/image/dashboard/image-dashboard';
import { ImageSkeleton } from '@/components/common/skeletons';

export default function ImageCanvasPage() {
  return (
    <Suspense fallback={<ImageSkeleton />}>
      <ImageDashboard />
    </Suspense>
  );
}
