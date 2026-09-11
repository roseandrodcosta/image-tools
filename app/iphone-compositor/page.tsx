import type { Metadata } from 'next';

import { IphoneCompositor } from '@/components/iphone-compositor';

export const metadata: Metadata = {
  title: 'iPhone UI Compositor | Image Tools',
  description:
    'Fit UI screenshots into a calibrated, immutable iPhone 16 Pro Max reference.',
};

export default function IphoneCompositorPage() {
  return <IphoneCompositor />;
}
