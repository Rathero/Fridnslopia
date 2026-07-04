/**
 * Date helpers. Play dates are plain `YYYY-MM-DD` strings (UTC calendar day),
 * matching the Postgres `date` column. Keeping them as strings avoids timezone
 * drift when doing streak arithmetic.
 */

/** Today as an ISO `YYYY-MM-DD` string (UTC). */
export function todayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The calendar day before the given `YYYY-MM-DD` string. */
export function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Normalise whatever pg returns for a `date` column to `YYYY-MM-DD` | null. */
export function toDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
