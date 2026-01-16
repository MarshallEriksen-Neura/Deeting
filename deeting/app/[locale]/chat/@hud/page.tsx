import { Suspense } from 'react';
import HudContainer from '../components/hud-container'; // Default export in original file
import { HudSkeleton } from '../components/hud-skeleton';

export default function HudPage() {
  return (
    <Suspense fallback={<HudSkeleton />}>
      <HudContainer />
    </Suspense>
  )
}
