/**
 * Helpers for the email-OTP sign-in input.
 *
 * Supabase's email OTP is **alphanumeric**, not numeric — letters AND
 * digits, always rendered in uppercase by Supabase emails. The length is
 * configurable in the Supabase Auth settings (default 6, often bumped to
 * 8 or 10).
 *
 * Earlier the input was wired as a 6-digit numeric field, which made:
 *  - 8-character codes silently truncate at 6
 *  - any letters in the code get stripped by `replace(/\D/g, '')`
 *  - the mobile keyboard show a numeric keypad
 *
 * Pulled out as a pure function so the sanitisation rules are testable
 * without mounting a React tree.
 */

/** Largest OTP length Supabase will issue. We accept up to this and let
 *  the server tell us if the actual value is shorter/longer. */
export const OTP_MAX_LENGTH = 10;

/** Shortest OTP Supabase will issue. Drives the "Verify" button's
 *  enable-state and the early-return guard in the verify call. */
export const OTP_MIN_LENGTH = 6;

/**
 * Clean raw input from the OTP field. Keeps only alphanumerics,
 * uppercases letters (to match the emailed code visually), and clamps
 * to OTP_MAX_LENGTH so a paste of "verification code: ABCD1234EXTRA"
 * yields "ABCD1234EX" (the relevant prefix) rather than an over-length
 * blob that the backend rejects without explanation.
 */
export function sanitiseOtpInput(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, OTP_MAX_LENGTH);
}

/** True when the cleaned input is long enough to attempt verification. */
export function isOtpLongEnough(code: string): boolean {
  return code.trim().length >= OTP_MIN_LENGTH;
}
