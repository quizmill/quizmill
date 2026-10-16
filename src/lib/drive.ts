/**
 * Drive mode — the hands-free voice quiz for the car.
 *
 * A device-level opt-in like Coach mode and Paper practice (NOT a pack
 * pref): it is about the car and the speech APIs, not the pack. Stored
 * app-level (bare `quizmill.` prefix) so it survives pack swaps and
 * "Reset all local progress"; an untouched device follows the pack's
 * `modes.drive` default (src/lib/practiceModes.ts). It used to live in
 * the pack's prefs blob as `driveMode`; that flag is promoted here on
 * first read, so nobody's switch flips off.
 */
import { modeEnabled, modePref } from './practiceModes';
import { forgetLegacyDriveMode, loadLegacyDriveMode } from './storage';

export const DRIVE_KEY = 'quizmill.drive.v1';

/** Local event fired after saveDriveModeEnabled so mounted hooks re-read. */
export const DRIVE_EVENT = 'quizmill:drive';

/** '1' = on, '0' = off; absent = the pack's `modes.drive` default. */
export const driveModePref = modePref({
  key: DRIVE_KEY,
  event: DRIVE_EVENT,
  legacy: { read: loadLegacyDriveMode, forget: forgetLegacyDriveMode },
});

export const loadDriveModeEnabled = (): boolean => modeEnabled(driveModePref, 'drive');
export const saveDriveModeEnabled = (on: boolean): void => driveModePref.save(on);
