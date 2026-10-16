/**
 * The occasional practice modes a device switches on — Drive, Coach,
 * Paper — and the pack's say in them.
 *
 * Each is a device pref (src/lib/drive.ts, coach.ts, paper.ts) with three
 * states, the same shape as the look: '1' = on and '0' = off pin the
 * device's choice; absent follows the pack's `modes` block in pack.json,
 * which defaults to off. So a showcase or kids' pack can ship a mode on,
 * and a learner who switches it off keeps it off, across pack swaps too.
 */
import { APP_CONFIG } from '@/config';
import { devicePref, type DevicePref, type DevicePrefSpec } from './devicePref';

export type PracticeMode = 'drive' | 'coach' | 'paper';

/** null = the device has not chosen; follow the pack. */
export type ModeChoice = boolean | null;

/** Whether the ACTIVE pack ships this mode on. */
export function packModeDefault(mode: PracticeMode): boolean {
  return APP_CONFIG.modes?.[mode] === true;
}

export function modePref(
  spec: Pick<DevicePrefSpec<ModeChoice>, 'key' | 'event' | 'legacy'>,
): DevicePref<ModeChoice> {
  return devicePref<ModeChoice>({
    ...spec,
    fallback: null,
    parse: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
    serialise: (on) => (on === null ? null : on ? '1' : '0'),
  });
}

/** The mode's effective state: the device's choice, else the pack's. */
export function modeEnabled(pref: DevicePref<ModeChoice>, mode: PracticeMode): boolean {
  return pref.load() ?? packModeDefault(mode);
}
