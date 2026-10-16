/**
 * Drive mode — the hands-free voice quiz for the car.
 *
 * A device-level opt-in like Coach mode and Paper practice (NOT a pack
 * pref): it is about the car and the speech APIs, not the pack. Stored
 * app-level (bare `quizmill.` prefix) so it survives pack swaps and
 * "Reset all local progress". It used to live in the pack's prefs blob
 * as `driveMode`; that flag is promoted here on first read, so nobody's
 * switch flips off.
 */
import { devicePref } from './devicePref';
import { forgetLegacyDriveMode, loadLegacyDriveMode } from './storage';

export const DRIVE_KEY = 'quizmill.drive.v1';

/** Local event fired after saveDriveModeEnabled so mounted hooks re-read. */
export const DRIVE_EVENT = 'quizmill:drive';

/** '1' = on; absent = off. */
export const driveModePref = devicePref<boolean>({
  key: DRIVE_KEY,
  event: DRIVE_EVENT,
  fallback: false,
  parse: (raw) => raw === '1',
  serialise: (on) => (on ? '1' : null),
  legacy: { read: loadLegacyDriveMode, forget: forgetLegacyDriveMode },
});

export const loadDriveModeEnabled = driveModePref.load;
export const saveDriveModeEnabled = driveModePref.save;
