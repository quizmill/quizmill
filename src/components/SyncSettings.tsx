'use client';

import { type ComponentType } from 'react';
import { syncBackendKind } from '@/lib/syncBackend';
import { SyncKeySettings } from '@/components/SyncKeySettings';

// Each backend brings its own sign-in UI, registered by kind. Custom
// backend providers (see registerSyncBackendProvider in
// src/lib/syncBackend.ts) register their card here the same way — and
// render it inside SyncCard (src/components/SyncStatusLine.tsx) so it
// shares the heading, loading state, status lines and footer of the
// built-in card.
const settingsCards: Record<string, ComponentType> = {
  http: SyncKeySettings,
};

/** Register the Settings card for a custom sync backend kind. Call from
 *  module scope alongside registerSyncBackendProvider. */
export function registerSyncSettingsCard(kind: string, card: ComponentType): void {
  settingsCards[kind] = card;
}

/**
 * "Sync across devices" card for the Settings page — renders the card
 * registered for whichever backend this build is wired to (see
 * src/lib/syncBackend.ts), or nothing when sync isn't configured.
 */
export function SyncSettings() {
  const kind = syncBackendKind();
  const Card = kind ? settingsCards[kind] : undefined;
  return Card ? <Card /> : null;
}
