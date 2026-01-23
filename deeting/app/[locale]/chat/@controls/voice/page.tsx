import { Suspense } from 'react';
import { VoiceInputToolbar } from '@/components/common/voice';
import { VoiceSkeleton } from '@/components/common/skeletons';

export default function VoicePage() {
  return (
    <Suspense fallback={<VoiceSkeleton />}>
      <VoiceInputToolbar />
    </Suspense>
  )
}
