'use client';

import { useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { ensureProfile, isSocialEnabled, refreshMyStats } from '@/lib/social';

const STORAGE_EVENT = 'quizmill:storage';

/**
 * Keeps a signed-in player's shareable stats fresh in the cloud so friends'
 * leaderboards reflect recent practice — even when the Friends page is never
 * opened. Dormant unless social is configured AND the user is signed in.
 *
 * Strategy: ensure the profile exists on sign-in, then mirror up a fresh
 * summary shortly after local writes settle (debounced off the storage
 * event bus), so a burst of answers becomes a single upsert. Renders nothing.
 */
export function SocialBootstrap() {
  useEffect(() => {
    if (!isSocialEnabled()) return;
    const sb = getSupabase();
    if (!sb) return;

    let signedIn = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (!signedIn) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshMyStats(), 3000);
    };

    const onSignedIn = async () => {
      signedIn = true;
      await ensureProfile();
      await refreshMyStats();
    };

    void sb.auth.getSession().then(({ data }) => {
      if (data.session) void onSignedIn();
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void onSignedIn();
      else signedIn = false;
    });

    window.addEventListener(STORAGE_EVENT, scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(STORAGE_EVENT, scheduleRefresh);
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
