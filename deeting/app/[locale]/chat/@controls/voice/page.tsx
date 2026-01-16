import { Suspense } from 'react';
import VoiceInputToolbar from '../../components/voice-toolbar';
import { VoiceSkeleton } from '../../components/voice-skeleton';

export default function VoicePage() {
  return (
    <Suspense fallback={<VoiceSkeleton />}>
      <VoiceInputToolbar />
    </Suspense>
  )
}
