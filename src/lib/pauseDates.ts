/**
 * The dates of a pause a CRM starts (21 Nov 2026, owner: "make end date mandatory on both web app and
 * android app"). A pause must have both a start date and an end date; an open-ended pause can no longer be
 * started from the CRM pause form.
 *
 * Pure functions, the same file byte for byte on the web (src/lib/pauseDates.ts) and in the app
 * (odds-app/src/lib/pauseDates.ts). Dates are "YYYY-MM-DD" text.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day written as YYYY-MM-DD. */
export function isYmd(value: string | null | undefined): boolean {
  const s = (value ?? "").trim();
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** What is wrong with the pause dates, in plain words, or null when they can be saved. */
export function pauseDatesProblem(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s) return "Pick the pause start date.";
  if (!isYmd(s)) return "The pause start date is not a real date.";
  if (!e) return "Pick the pause end date.";
  if (!isYmd(e)) return "The pause end date is not a real date.";
  if (e < s) return "The pause end date is before the start date.";
  return null;
}

/** The end date that many days after the start (7 gives one week later), or "" when the start is not a date. */
export function pauseEndAfter(start: string | null | undefined, days: number): string {
  const s = (start ?? "").trim();
  if (!isYmd(s) || !Number.isFinite(days)) return "";
  return new Date(Date.parse(`${s}T00:00:00Z`) + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}
