// Sends the host's current IANA timezone as the `X-timezone` header on every service request.

/** Header name used to carry the caller's IANA timezone. */
export const TIMEZONE_HEADER = 'X-timezone';

/** Resolve the current IANA timezone (e.g. `Asia/Calcutta`); undefined when Intl is unavailable. */
export function getCurrentTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
