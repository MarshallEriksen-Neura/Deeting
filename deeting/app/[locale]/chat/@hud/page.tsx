import { Suspense } from 'react';
import HUD from '@/components/common/hud';
import { HudSkeleton } from '@/components/common/skeletons';

export default function HudPage() {
  return (
    <Suspense fallback={<HudSkeleton />}>
      <HUD />
    </Suspense>
  )
}
