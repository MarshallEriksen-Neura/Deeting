"use client";

import { Suspense } from 'react';
import VideoDashboard from '@/components/video/dashboard/video-dashboard';
import { VideoSkeleton } from '@/components/common/skeletons';

export default function VideosPage() {
  return (
    <Suspense fallback={<VideoSkeleton />}>
      <VideoDashboard />
    </Suspense>
  );
}